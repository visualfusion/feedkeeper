import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import Database from "better-sqlite3";

test("backup includes uncheckpointed WAL changes and archived images, and restore recovers both", () => {
  const directory = mkdtempSync(join(tmpdir(), "feedkeeper-backup-test-"));
  const databasePath = join(directory, "live.sqlite");
  const backupPath = join(directory, "backup.sqlite");
  const serverRoot = resolve(import.meta.dirname, "..");
  const environment = {
    ...process.env,
    DATABASE_PATH: databasePath,
    SESSION_SECRET: "test-session-secret-at-least-32-characters",
  };
  const runCli = (action: string, args: string[]) => {
    const result = spawnSync("tsx", ["src/backup-cli.ts", action, ...args], {
      cwd: serverRoot,
      env: environment,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };

  try {
    const live = new Database(databasePath);
    try {
      live.pragma("journal_mode = WAL");
      live.pragma("wal_autocheckpoint = 0");
      live.exec("CREATE TABLE sample (value TEXT)");
      live.prepare("INSERT INTO sample (value) VALUES (?)").run("in WAL");
      // Images of saved articles sit in the archive folder next to the database.
      mkdirSync(join(directory, "archive"));
      writeFileSync(join(directory, "archive", "1-0123456789abcdef.jpg"), "image");
      runCli("backup", [backupPath]);
      assert.equal(readFileSync(join(`${backupPath}.archive`, "1-0123456789abcdef.jpg"), "utf8"), "image");

      const backup = new Database(backupPath, { readonly: true });
      try {
        assert.equal(backup.prepare("SELECT value FROM sample").get()?.value, "in WAL");
      } finally {
        backup.close();
      }
      live.exec("DELETE FROM sample");
    } finally {
      live.close();
    }

    rmSync(join(directory, "archive"), { recursive: true });
    runCli("restore", [backupPath, "--force"]);
    assert.ok(existsSync(join(directory, "archive", "1-0123456789abcdef.jpg")));
    const restored = new Database(databasePath, { readonly: true });
    try {
      assert.equal(restored.prepare("SELECT value FROM sample").get()?.value, "in WAL");
    } finally {
      restored.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("restore works from a backup that sits in a folder nothing can be written to", { skip: process.getuid?.() === 0 }, () => {
  // A single file mounted into a container is exactly this: SQLite cannot create its -shm file beside it.
  const directory = mkdtempSync(join(tmpdir(), "feedkeeper-restore-ro-"));
  const databasePath = join(directory, "live.sqlite");
  const readOnlyFolder = join(directory, "readonly");
  const backupPath = join(readOnlyFolder, "backup.sqlite");
  const serverRoot = resolve(import.meta.dirname, "..");
  const environment = { ...process.env, DATABASE_PATH: databasePath, SESSION_SECRET: "test-session-secret-at-least-32-characters" };
  const runCli = (action: string, args: string[]) => {
    const result = spawnSync("tsx", ["src/backup-cli.ts", action, ...args], { cwd: serverRoot, env: environment, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };
  try {
    mkdirSync(readOnlyFolder);
    const source = new Database(backupPath);
    source.pragma("journal_mode = WAL");
    source.exec("CREATE TABLE sample (value TEXT)");
    source.prepare("INSERT INTO sample (value) VALUES (?)").run("from a read-only folder");
    source.close();
    rmSync(`${backupPath}-wal`, { force: true });
    rmSync(`${backupPath}-shm`, { force: true });
    chmodSync(readOnlyFolder, 0o500);

    runCli("restore", [backupPath, "--force"]);
    const restored = new Database(databasePath, { readonly: true });
    try {
      assert.equal(restored.prepare("SELECT value FROM sample").get()?.value, "from a read-only folder");
    } finally {
      restored.close();
    }
    assert.equal(existsSync(`${backupPath}-shm`), false, "nothing was written next to the backup");
  } finally {
    chmodSync(readOnlyFolder, 0o700);
    rmSync(directory, { recursive: true, force: true });
  }
});
