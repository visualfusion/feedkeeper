import Database from "better-sqlite3";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { config } from "./config.js";

function assertHealthy(database: Database.Database): void {
  const result = database.pragma("integrity_check", { simple: true });
  if (result !== "ok") throw new Error(`SQLite integrity check failed: ${String(result)}`);
}

// Images of saved articles live next to the backup file as "<backup>.archive".
const archiveCopyOf = (backupFile: string) => `${backupFile}.archive`;

function hasFiles(directory: string): boolean {
  return existsSync(directory) && readdirSync(directory).length > 0;
}

async function main(): Promise<void> {
  const [action, filename, flag] = process.argv.slice(2);
  if (!(["backup", "restore"].includes(action) && filename)) {
    throw new Error("Usage: npm run db:backup -- <destination> | npm run db:restore -- <backup> --force");
  }

  const databasePath = resolve(config.databasePath);
  const filePath = resolve(filename);
  if (databasePath === filePath) throw new Error("Source and destination must differ");

  if (action === "backup") {
    if (!existsSync(databasePath)) throw new Error(`Database not found: ${databasePath}`);
    if (existsSync(filePath)) throw new Error(`Backup already exists: ${filePath}`);
    mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
    process.umask(0o077);
    const { db } = await import("./db/index.js");
    try {
      await db.backup(filePath);
      const saved = new Database(filePath, { readonly: true, fileMustExist: true });
      try {
        assertHealthy(saved);
      } finally {
        saved.close();
      }
      console.log(`Backup verified: ${filePath}`);
      const archivePath = resolve(config.archivePath);
      if (hasFiles(archivePath)) {
        cpSync(archivePath, archiveCopyOf(filePath), { recursive: true, errorOnExist: true, force: false });
        console.log(`Archived images copied: ${archiveCopyOf(filePath)}`);
      }
    } catch (error) {
      if (existsSync(filePath)) unlinkSync(filePath);
      rmSync(archiveCopyOf(filePath), { recursive: true, force: true });
      throw error;
    } finally {
      db.close();
    }
    return;
  }

  if (flag !== "--force") throw new Error("Restore replaces the configured database. Stop FeedKeeper and pass --force.");
  if (!existsSync(filePath) || !statSync(filePath).isFile()) throw new Error(`Backup file not found: ${filePath}`);
  // A backup is a WAL-mode database, and SQLite needs to create a -shm file next to a database it opens, even for
  // reading. The backup may sit where nothing can be created (a single file mounted into a container, a read-only
  // volume), so it is opened from a copy in the temporary folder.
  const scratch = mkdtempSync(join(tmpdir(), "feedkeeper-restore-"));
  const copy = join(scratch, "backup.sqlite");
  copyFileSync(filePath, copy);
  const source = new Database(copy, { readonly: true, fileMustExist: true });
  try {
    assertHealthy(source);
    mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
    process.umask(0o077);
    await source.backup(databasePath);
  } finally {
    source.close();
    rmSync(scratch, { recursive: true, force: true });
  }
  const restored = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    assertHealthy(restored);
  } finally {
    restored.close();
  }
  console.log(`Database restored and verified: ${databasePath}`);

  const archiveBackup = archiveCopyOf(filePath);
  if (existsSync(archiveBackup)) {
    const archivePath = resolve(config.archivePath);
    rmSync(archivePath, { recursive: true, force: true });
    cpSync(archiveBackup, archivePath, { recursive: true });
    console.log(`Archived images restored: ${archivePath}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
