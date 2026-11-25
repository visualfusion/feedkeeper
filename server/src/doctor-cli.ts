import Database from "better-sqlite3";
import { constants, accessSync, existsSync, readFileSync, readdirSync, statfsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { APP_VERSION } from "./version.js";

export type DoctorStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  detail: string;
}

export interface DoctorReport {
  version: string;
  ok: boolean;
  checks: DoctorCheck[];
}

export interface DoctorOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  home?: string;
  dataDir?: string;
  publicUrl?: string;
  nodeVersion?: string;
}

const MIN_DISK_BYTES = 100 * 1024 * 1024; // 100 MiB

function parseSemver(version: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isSupportedNodeVersion(version: string): boolean {
  const parsed = parseSemver(version);
  if (!parsed) return false;
  const [major, minor, patch] = parsed;
  if (major === 22) return minor > 22 || (minor === 22 && patch >= 2);
  if (major === 24) return minor > 15 || (minor === 15 && patch >= 0);
  return major >= 26;
}

function nearestExistingDir(target: string): string | null {
  let current = resolve(target);
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return current;
}

function isWritable(target: string): { writable: boolean; existing: string | null } {
  const existing = nearestExistingDir(target);
  if (!existing) return { writable: false, existing: null };
  try {
    accessSync(existing, constants.R_OK | constants.W_OK);
    return { writable: true, existing };
  } catch {
    return { writable: false, existing };
  }
}

function formatMiB(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MiB`;
}

/** Runs read-only diagnostics on the runtime, configuration, storage paths, and SQLite database. */
export function runDoctor(options: DoctorOptions = {}): DoctorReport {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const home = options.home ?? homedir();
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const checks: DoctorCheck[] = [];

  if (isSupportedNodeVersion(nodeVersion)) {
    checks.push({ name: "Node.js", status: "pass", detail: `v${nodeVersion} (supported)` });
  } else {
    checks.push({
      name: "Node.js",
      status: "fail",
      detail: `v${nodeVersion} is unsupported (requires ^22.22.2 || ^24.15.0 || >=26.0.0)`,
    });
  }

  const configuredDb = env.DATABASE_PATH?.trim();
  const dataDir = resolve(
    options.dataDir ?? (env.FEEDKEEPER_DATA_DIR?.trim() || (configuredDb ? dirname(resolve(configuredDb)) : join(home, ".feedkeeper"))),
  );
  const databasePath = options.dataDir !== undefined || !configuredDb ? join(dataDir, "feedkeeper.sqlite") : resolve(configuredDb);
  const archivePath = env.ARCHIVE_PATH?.trim() ? resolve(env.ARCHIVE_PATH.trim()) : join(dirname(databasePath), "archive");
  const imageCachePath = env.IMAGE_CACHE_PATH?.trim() ? resolve(env.IMAGE_CACHE_PATH.trim()) : join(dirname(databasePath), "image-cache");

  const envSecret = env.SESSION_SECRET?.trim() ?? "";
  const secretFilePath = join(dataDir, "session-secret");
  let fileSecret = "";
  if (!envSecret && existsSync(secretFilePath)) {
    try {
      fileSecret = readFileSync(secretFilePath, "utf8").trim();
    } catch (error) {
      checks.push({
        name: "SESSION_SECRET",
        status: "fail",
        detail: `Could not read ${secretFilePath}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  const effectiveSecret = envSecret || fileSecret;
  if (effectiveSecret) {
    const source = envSecret ? "environment" : secretFilePath;
    if (effectiveSecret.length < 32) {
      checks.push({
        name: "SESSION_SECRET",
        status: "warn",
        detail: `Set via ${source}, but shorter than 32 characters`,
      });
    } else {
      checks.push({ name: "SESSION_SECRET", status: "pass", detail: `Configured via ${source}` });
    }
  } else if (!checks.some(check => check.name === "SESSION_SECRET")) {
    const envFile = resolve(cwd, ".env");
    checks.push({
      name: "SESSION_SECRET",
      status: "warn",
      detail: existsSync(envFile)
        ? `Not set in ${envFile} or ${secretFilePath} (generated on first start in CLI mode)`
        : "Not set (generated on first start in CLI mode; set explicitly for Docker/production)",
    });
  }

  const publicUrl = (options.publicUrl ?? env.PUBLIC_URL?.trim()) || `http://localhost:${env.PORT?.trim() || 3000}`;
  try {
    const parsed = new URL(publicUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      checks.push({ name: "PUBLIC_URL", status: "fail", detail: `Invalid protocol "${parsed.protocol}" in ${publicUrl}` });
    } else if ((env.NODE_ENV ?? "production") === "production" && parsed.hostname === "localhost" && !env.PUBLIC_URL?.trim()) {
      checks.push({ name: "PUBLIC_URL", status: "warn", detail: `Defaults to ${publicUrl} (set PUBLIC_URL for remote access or OAuth)` });
    } else {
      checks.push({ name: "PUBLIC_URL", status: "pass", detail: publicUrl });
    }
  } catch {
    checks.push({ name: "PUBLIC_URL", status: "fail", detail: `Invalid URL "${publicUrl}"` });
  }

  for (const [label, target] of [
    ["Data directory", dataDir],
    ["Archive directory", archivePath],
    ["Image cache directory", imageCachePath],
  ] as const) {
    const access = isWritable(target);
    if (access.writable) {
      const suffix = existsSync(target) ? "" : ` (will be created under ${access.existing})`;
      checks.push({ name: label, status: "pass", detail: `${target} is writable${suffix}` });
    } else {
      checks.push({
        name: label,
        status: "fail",
        detail: `${target} is not writable${access.existing ? ` (checked ${access.existing})` : ""}`,
      });
    }
  }

  const diskTarget = nearestExistingDir(dataDir);
  if (diskTarget) {
    try {
      const stats = statfsSync(diskTarget);
      const freeBytes = Number(stats.bavail) * Number(stats.bsize);
      if (freeBytes < MIN_DISK_BYTES) {
        checks.push({ name: "Disk space", status: "warn", detail: `Only ${formatMiB(freeBytes)} free on ${diskTarget}` });
      } else {
        checks.push({ name: "Disk space", status: "pass", detail: `${formatMiB(freeBytes)} free on ${diskTarget}` });
      }
    } catch (error) {
      checks.push({
        name: "Disk space",
        status: "warn",
        detail: `Could not inspect free space on ${diskTarget}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  if (!existsSync(databasePath)) {
    checks.push({
      name: "SQLite database",
      status: "warn",
      detail: `${databasePath} does not exist yet (will be initialized on first start)`,
    });
  } else {
    let db: Database.Database | null = null;
    try {
      db = new Database(databasePath, { readonly: true, fileMustExist: true });
      const integrity = db.pragma("quick_check", { simple: true });
      if (integrity !== "ok") {
        checks.push({ name: "SQLite database", status: "fail", detail: `${databasePath} failed quick_check: ${String(integrity)}` });
      } else {
        const hasMigrations = db
          .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_migrations'")
          .get();
        if (!hasMigrations) {
          checks.push({
            name: "SQLite database",
            status: "warn",
            detail: `${databasePath} passed quick_check, but has no _migrations table yet`,
          });
        } else {
          const applied = db.prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM _migrations").get()?.count ?? 0;
          const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "db", "migrations");
          const available = existsSync(migrationsDir)
            ? readdirSync(migrationsDir).filter(file => file.endsWith(".sql")).length
            : applied;
          const migrationInfo = applied < available ? `${applied}/${available} migrations applied` : `${applied} migrations applied`;
          checks.push({ name: "SQLite database", status: "pass", detail: `${databasePath} ok (${migrationInfo})` });
        }
      }
    } catch (error) {
      checks.push({
        name: "SQLite database",
        status: "fail",
        detail: `Could not open ${databasePath}: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      db?.close();
    }
  }

  return {
    version: APP_VERSION,
    ok: checks.every(check => check.status !== "fail"),
    checks,
  };
}

export function formatDoctorReport(report: DoctorReport): string {
  const tags: Record<DoctorStatus, string> = {
    pass: "PASS",
    warn: "WARN",
    fail: "FAIL",
  };
  const lines = [`FeedKeeper doctor v${report.version}`, ""];
  for (const check of report.checks) {
    lines.push(`[${tags[check.status]}] ${check.name}: ${check.detail}`);
  }
  const fails = report.checks.filter(check => check.status === "fail").length;
  const warns = report.checks.filter(check => check.status === "warn").length;
  lines.push("");
  lines.push(report.ok ? `Summary: ok (${warns} warning${warns === 1 ? "" : "s"})` : `Summary: ${fails} failed, ${warns} warning${warns === 1 ? "" : "s"}`);
  return lines.join("\n");
}

export function runDoctorCli(options: DoctorOptions = {}): number {
  const envFile = resolve(options.cwd ?? process.cwd(), ".env");
  if (existsSync(envFile) && !options.env) {
    process.loadEnvFile(envFile);
  }
  const report = runDoctor(options);
  console.log(formatDoctorReport(report));
  return report.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = runDoctorCli();
}
