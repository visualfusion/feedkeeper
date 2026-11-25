import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { formatDoctorReport, isSupportedNodeVersion, runDoctor } from "../src/doctor-cli.js";

const scratch = mkdtempSync(join(tmpdir(), "feedkeeper-doctor-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

test("recognizes supported Node.js versions", () => {
  assert.equal(isSupportedNodeVersion("22.22.2"), true);
  assert.equal(isSupportedNodeVersion("22.22.1"), false);
  assert.equal(isSupportedNodeVersion("24.15.0"), true);
  assert.equal(isSupportedNodeVersion("24.14.9"), false);
  assert.equal(isSupportedNodeVersion("26.0.0"), true);
  assert.equal(isSupportedNodeVersion("20.19.0"), false);
});

test("reports a clean pass for a healthy database and secret without leaking the secret", () => {
  const dataDir = join(scratch, "healthy");
  mkdirSync(dataDir, { recursive: true });
  const secretValue = "super-secret-value-that-must-never-appear-in-output-123456";
  writeFileSync(join(dataDir, "session-secret"), `${secretValue}\n`);

  const dbPath = join(dataDir, "feedkeeper.sqlite");
  const db = new Database(dbPath);
  db.exec("CREATE TABLE _migrations (name TEXT PRIMARY KEY); INSERT INTO _migrations (name) VALUES ('0001_init.sql');");
  db.close();

  const report = runDoctor({
    dataDir,
    cwd: dataDir,
    nodeVersion: "24.15.0",
    env: {
      NODE_ENV: "production",
      PUBLIC_URL: "https://feeds.example.org",
    },
  });

  assert.equal(report.ok, true);
  assert.ok(report.checks.every(check => check.status === "pass"));
  const text = formatDoctorReport(report);
  assert.ok(!text.includes(secretValue));
  assert.match(text, /\[PASS\] SQLite database:/);
});

test("warns on missing secret or missing database without creating files", () => {
  const dataDir = join(scratch, "fresh");
  const report = runDoctor({
    dataDir,
    cwd: scratch,
    nodeVersion: "22.22.2",
    env: {},
  });

  assert.equal(report.ok, true);
  assert.equal(existsSync(dataDir), false);
  const secretCheck = report.checks.find(check => check.name === "SESSION_SECRET");
  const dbCheck = report.checks.find(check => check.name === "SQLite database");
  assert.equal(secretCheck?.status, "warn");
  assert.equal(dbCheck?.status, "warn");
});

test("fails on invalid PUBLIC_URL, unsupported Node version, or corrupt SQLite file", () => {
  const dataDir = join(scratch, "broken");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, "feedkeeper.sqlite"), "not a sqlite file");

  const report = runDoctor({
    dataDir,
    cwd: scratch,
    nodeVersion: "20.18.0",
    env: {
      SESSION_SECRET: "short",
      PUBLIC_URL: "ftp://feeds.example.org",
    },
  });

  assert.equal(report.ok, false);
  assert.equal(report.checks.find(check => check.name === "Node.js")?.status, "fail");
  assert.equal(report.checks.find(check => check.name === "PUBLIC_URL")?.status, "fail");
  assert.equal(report.checks.find(check => check.name === "SQLite database")?.status, "fail");
  assert.equal(report.checks.find(check => check.name === "SESSION_SECRET")?.status, "warn");
});
