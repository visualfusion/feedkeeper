import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieSession from "cookie-session";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { clientAddressFromHeader } from "./clientAddress.js";
import { runMigrations } from "./db/index.js";
import { apiRouter } from "./api/index.js";
import { mcpRouter } from "./mcp/http.js";
import { oauthAuthorizeRouter, oauthPublicRouter } from "./oauth/routes.js";
import { startFullTextScheduler } from "./feeds/fullTextQueue.js";
import { installPollingShutdown, startPollingScheduler } from "./feeds/poller.js";
import { startCleanupScheduler } from "./feeds/cleanup.js";
import { repairEncodedText } from "./feeds/repository.js";
import { pruneArchive, scheduleMissingArchives } from "./feeds/archive.js";
import { startEditionScheduler } from "./native/editions.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIST = join(__dirname, "../../web/dist");

runMigrations();
const repairedItems = repairEncodedText();
if (repairedItems > 0) console.log(`[db] decoded HTML entities in ${repairedItems} stored items`);
pruneArchive();
const pendingArchives = scheduleMissingArchives();
if (pendingArchives > 0) console.log(`[archive] archiving ${pendingArchives} saved articles in the background`);
startPollingScheduler();
startFullTextScheduler();
startCleanupScheduler();
startEditionScheduler();

const app = express();

// Express validates the addresses here, so a mistyped TRUST_PROXY list stops the server at startup.
if (config.trustProxy !== false) {
  app.set("trust proxy", config.trustProxy);
}
if (config.clientIpHeader && !Array.isArray(config.trustProxy)) {
  console.warn("[config] CLIENT_IP_HEADER is ignored: it needs TRUST_PROXY to list the trusted proxies");
}
// Before every rate limiter, so limits count the CDN's client rather than its edge.
app.use(clientAddressFromHeader(config.clientIpHeader, config.trustProxy));

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "script-src": ["'self'"],
        "img-src": ["'self'", "data:", "https:", "http:"],
      },
    },
  }),
);
// Send X-Robots-Tag to ensure all HTTP endpoints disallow indexing even outside HTML
app.use((_req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  next();
});
// Connector backends and browser tools call these without our cookies, so they sit before the same-origin CORS rule.
app.use(oauthPublicRouter);
app.use(
  cors({
    origin: config.publicUrl,
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(express.text({ type: ["application/xml", "text/xml", "text/plain"], limit: "5mb" }));
app.use(
  cookieSession({
    name: "feedkeeper.sid",
    secret: config.sessionSecret,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: "lax",
    secure: config.publicUrl.startsWith("https://"),
  }),
);

// Generic API rate limit as defense in depth on top of the stricter
// per-route limiter on /api/auth/login.
app.use(
  "/api",
  rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    // Lists load many article images and feed icons at once; those routes have their own, higher limit.
    skip: (req) => /^\/(v1\/)?(items\/\d+\/image|feeds\/\d+\/icon|subscriptions\/\d+\/icon|archive\/images\/\d+)$/.test(req.path),
  }),
);

app.use("/api", apiRouter);
app.use(oauthAuthorizeRouter);
app.use("/mcp", mcpRouter);

if (existsSync(WEB_DIST)) {
  app.use(
    express.static(WEB_DIST, {
      setHeaders(res, filePath) {
        // Hashed build files never change; the service worker must always be re-checked.
        if (filePath.includes(`${sep}assets${sep}`)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        if (filePath.endsWith(`${sep}sw.js`)) res.setHeader("Cache-Control", "no-cache");
      },
    }),
  );
  app.get(/(.*)/, (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/mcp") || req.path.startsWith("/oauth") || req.path.startsWith("/.well-known")) return next();
    res.sendFile(join(WEB_DIST, "index.html"));
  });
}

const server = app.listen(config.port, () => {
  console.log(`[feedkeeper] listening on port ${config.port}`);
});

installPollingShutdown(server);
