import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieSession from "cookie-session";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { runMigrations } from "./db/index.js";
import { apiRouter } from "./api/index.js";
import { mcpRouter } from "./mcp/http.js";
import { startPollingScheduler } from "./feeds/poller.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIST = join(__dirname, "../../web/dist");

runMigrations();
startPollingScheduler();

const app = express();

if (config.trustProxy) {
  app.set("trust proxy", 1);
}

app.use(helmet());
app.use(
  cors({
    origin: config.publicUrl,
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));
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
  rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false }),
);

app.use("/api", apiRouter);
app.use("/mcp", mcpRouter);

if (existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get(/(.*)/, (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/mcp")) return next();
    res.sendFile(join(WEB_DIST, "index.html"));
  });
}

app.listen(config.port, () => {
  console.log(`[feedkeeper] listening on port ${config.port}`);
});
