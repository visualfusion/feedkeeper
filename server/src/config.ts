import { config as loadEnv } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readPollSettings } from "./feeds/pollSettings.js";
import { parseTrustProxy } from "./trustProxy.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Loads the repo-root .env regardless of the process's current working
// directory, so `npm run dev`/`start` behave the same from anywhere.
// `quiet: true` suppresses dotenv's own console output (including its
// unrelated third-party promo "tips"), which has no place in server logs.
loadEnv({ path: join(__dirname, "../../.env"), quiet: true });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  polling: readPollSettings(),
  port: Number(process.env.PORT ?? 3000),
  publicUrl: required("PUBLIC_URL", "http://localhost:3000"),
  databasePath: required("DATABASE_PATH", "./data/feedkeeper.sqlite"),
  // Images of saved articles live outside the database so it stays small.
  archivePath: process.env.ARCHIVE_PATH ?? join(dirname(process.env.DATABASE_PATH ?? "./data/feedkeeper.sqlite"), "archive"),
  sessionSecret: required("SESSION_SECRET"),
  allowSignup: process.env.ALLOW_SIGNUP === "true",
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  clientIpHeader: process.env.CLIENT_IP_HEADER?.trim() || null,
  minPollIntervalMinutes: Number(process.env.MIN_POLL_INTERVAL_MINUTES ?? 5),
  retentionReadDays: Number(process.env.RETENTION_READ_DAYS ?? 30),
  retentionMaxDays: Number(process.env.RETENTION_MAX_DAYS ?? 90),
  retentionMaxItemsPerFeed: Number(process.env.RETENTION_MAX_ITEMS_PER_FEED ?? 1000),
  autoCleanupEnabled: process.env.AUTO_CLEANUP_ENABLED !== "false",
  // Optional: only these hosts may register OAuth redirect URIs (comma-separated). Loopback addresses are always allowed.
  oauthAllowedRedirectHosts: (process.env.OAUTH_ALLOWED_REDIRECT_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
  showGithubLink: process.env.SHOW_GITHUB_LINK !== "false",
  githubUrl: process.env.GITHUB_URL ?? "https://github.com/visualfusion/feedkeeper",
};

if (!config.sessionSecret.trim()) {
  throw new Error("SESSION_SECRET must not be empty");
}
if (config.sessionSecret.trim().length < 32) {
  console.warn("[config] SESSION_SECRET is shorter than 32 characters; use a long random secret for new installations");
}
