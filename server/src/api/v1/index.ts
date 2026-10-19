import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { createPairingCode, redeemPairingCode } from "../../auth/pairing.js";
import { requireSession, requireSessionOrDevice } from "../../auth/middleware.js";
import { deleteDevice, listDevicesForUser } from "../../auth/tokens.js";
import { findUserById } from "../../auth/users.js";
import { config } from "../../config.js";
import { getRetentionSettings } from "../../feeds/cleanup.js";
import { APP_VERSION } from "../../version.js";
import { ResyncRequired, currentSeq, listChanges } from "../../sync/changeLog.js";
import { applyMutations } from "../../sync/mutations.js";
import { getUserCapabilities, requireCapability } from "../../auth/capabilities.js";
import { resourcesRouter } from "./resources.js";

/** The API for native apps. See docs/design/native-api.md for the contract and what is still to come. */
export const v1Router = Router();

// Features grow with the implementation; clients look here instead of guessing from the version.
const FEATURES = [
  "pairing",
  "sync",
  "mutations",
  "subscriptions",
  "folders",
  "items",
  "fulltext",
  "content.revisions",
  "content.prepare",
  "item.lead",
  "item.author",
  "item.empty-gallery",
  "images",
  "muted-keywords",
  "opml",
  "retention",
  "feed-icons",
  "folder-icons",
  "notes",
  "edition",
  "edition.revisions",
  "native-preferences",
  "native-preferences.edition-size",
  "edition.overview",
  "edition.layout",
  "search.fts",
  "account-capabilities",
  "mcp",
  "inbox",
];

v1Router.get("/meta", (_req, res) => {
  const retention = getRetentionSettings();
  res.json({
    apiVersion: 1,
    serverVersion: APP_VERSION,
    features: FEATURES,
    limits: {
      maxMutationsPerRequest: 200,
      // Kept for clients that only know the maximum age.
      retentionDays: retention.retentionMaxDays,
      // Deletions caused by retention are not announced through /sync, so clients apply the same rules
      // to their local copy. A value of 0 switches that rule off; saved articles are never removed.
      retention: {
        enabled: retention.autoCleanupEnabled,
        readDays: retention.retentionReadDays,
        maxDays: retention.retentionMaxDays,
        maxItemsPerFeed: retention.retentionMaxItemsPerFeed,
        protectActiveEdition: true,
      },
    },
    minClientVersion: null,
  });
});

// The web app creates the code; the app redeems it. Rate limited, as the code is the only secret.
v1Router.post("/pairing-codes", requireSession, (req, res) => {
  const { code, expiresAt } = createPairingCode(req.user!.id);
  const pairingUrl = `feedkeeper://pair?server=${encodeURIComponent(config.publicUrl)}&code=${encodeURIComponent(code)}`;
  res.status(201).json({ code, expiresAt, pairingUrl });
});

const pairSchema = z.object({
  code: z.string().min(8).max(40),
  deviceName: z.string().trim().min(1).max(100),
  platform: z.string().trim().min(1).max(40),
  appVersion: z.string().trim().max(40).optional(),
});

v1Router.post("/devices/pair", rateLimit({ windowMs: 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false }), (req, res) => {
  const parsed = pairSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  const paired = redeemPairingCode(parsed.data.code, { name: parsed.data.deviceName, platform: parsed.data.platform, appVersion: parsed.data.appVersion ?? null });
  if (!paired) {
    res.status(400).json({ error: "invalid_or_expired_code" });
    return;
  }
  const user = findUserById(paired.userId)!;
  // The token is shown here once; only its hash is stored.
  res.status(201).json({
    deviceId: paired.deviceId,
    token: paired.token,
    user: { id: user.id, email: user.email, displayName: user.display_name },
  });
});

v1Router.use(requireSessionOrDevice);

// A read-only token may look at everything but change nothing.
v1Router.use((req, res, next) => {
  if (req.method !== "GET" && req.tokenScope === "read") {
    res.status(403).json({ error: "read_only_token" });
    return;
  }
  next();
});

v1Router.get("/me", (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  const { id, email, display_name, role } = req.user!;
  res.json({
    id,
    email,
    displayName: display_name,
    role,
    scope: req.tokenScope ?? "write",
    deviceId: req.tokenKind === "device" ? req.tokenId : null,
    capabilities: getUserCapabilities(id),
  });
});

v1Router.get("/devices", (req, res) => {
  res.json(
    listDevicesForUser(req.user!.id).map((device) => ({
      id: device.id,
      name: device.name,
      platform: device.platform,
      appVersion: device.app_version,
      createdAt: device.created_at,
      lastUsedAt: device.last_used_at,
      current: req.tokenKind === "device" && req.tokenId === device.id,
    })),
  );
});

v1Router.delete("/devices/:deviceId", (req, res) => {
  if (!deleteDevice(req.user!.id, Number(req.params.deviceId))) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.status(204).end();
});

const syncQuery = z.object({
  since: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

// Changes to the user's own data (articles' state, subscriptions, folders, keywords) since `since`.
// since=0 delivers the complete state, as the log holds one entry per object.
v1Router.get("/sync", requireCapability("sync"), (req, res) => {
  const parsed = syncQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }
  try {
    res.json(listChanges(req.user!.id, parsed.data.since, parsed.data.limit));
  } catch (error) {
    if (error instanceof ResyncRequired) {
      res.status(410).json({ error: "resync_required", message: "Drop the local copy and sync again from since=0." });
      return;
    }
    throw error;
  }
});

// Changes made offline; every one carries a client id, so retrying a request is safe.
v1Router.post("/mutations", (req, res) => {
  if (req.tokenScope === "read") {
    res.status(403).json({ error: "read_only_token" });
    return;
  }
  const mutations = req.body?.mutations;
  if (!Array.isArray(mutations) || mutations.length === 0 || mutations.length > 200) {
    res.status(400).json({ error: "invalid_input", message: "Send 1 to 200 mutations." });
    return;
  }
  const results = applyMutations(req.user!.id, mutations);
  res.json({ results, seq: currentSeq(req.user!.id) });
});

v1Router.use(resourcesRouter);
