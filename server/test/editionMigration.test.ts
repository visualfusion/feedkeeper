import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

test("curated-only upgrade retires generated slots without restoring or changing curated publications", () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const directory = fileURLToPath(new URL("../src/db/migrations/", import.meta.url));
  for (const name of readdirSync(directory).filter((name) => name.endsWith(".sql") && name < "0036").sort()) {
    db.exec(readFileSync(directory + name, "utf8"));
  }
  const automatic = Number(db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES ('automatic@test.local', 'unchanged', 'Automatic')").run().lastInsertRowid);
  const curated = Number(db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES ('curated@test.local', 'unchanged', 'Curated')").run().lastInsertRowid);
  const insert = db.prepare("INSERT INTO editions (user_id, edition_id, revision, source, status, item_ids, created_at, updated_at, expires_at) VALUES (?, ?, 98, ?, 'active', '[42]', '2026-10-14T06:00:00Z', '2026-10-14T06:00:00Z', '2026-10-14T09:00:00Z')");
  insert.run(automatic, "generated", "automatic");
  insert.run(curated, "original-morning", "curated");
  const original = db.prepare("SELECT * FROM editions WHERE user_id = ?").get(curated);
  db.exec(readFileSync(directory + "0036_curated_only_editions.sql", "utf8"));
  assert.deepEqual(db.prepare("SELECT * FROM editions WHERE user_id = ?").get(curated), original);
  const retired = db.prepare("SELECT edition_id, status, revision FROM editions WHERE user_id = ?").get(automatic)!;
  assert.equal(retired.edition_id, "generated", "no older publication is restored");
  assert.equal(retired.status, "expired", "retirement must not block the curator as an explicit dismissal would");
  assert.equal(retired.revision, 99);
  assert.equal(db.prepare("SELECT password_hash FROM users WHERE id = ?").get(automatic)?.password_hash, "unchanged");
  db.close();
});

test("edition upgrade preserves accounts, notes, symbols and an existing curated issue", () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const directory = fileURLToPath(new URL("../src/db/migrations/", import.meta.url));
  for (const name of readdirSync(directory).filter((name) => name.endsWith(".sql") && name < "0023").sort()) {
    db.exec(readFileSync(directory + name, "utf8"));
  }
  const user = Number(db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES ('legacy@test.local', 'unchanged-hash', 'Legacy')").run().lastInsertRowid);
  const folder = Number(db.prepare("INSERT INTO folders (user_id, name, icon_symbol) VALUES (?, 'News', 'newspaper')").run(user).lastInsertRowid);
  const feed = Number(db.prepare("INSERT INTO feeds (url, title) VALUES ('https://test.local/rss', 'Source')").run().lastInsertRowid);
  db.prepare("INSERT INTO subscriptions (user_id, feed_id, folder_id) VALUES (?, ?, ?)").run(user, feed, folder);
  const item = Number(db.prepare("INSERT INTO items (feed_id, guid, title) VALUES (?, 'legacy', 'Keep me')").run(feed).lastInsertRowid);
  db.prepare("INSERT INTO item_notes (user_id, item_id, content, revision) VALUES (?, ?, 'Keep my note', 4)").run(user, item);
  db.prepare("INSERT INTO editions (user_id, item_ids, revision, created_at, updated_at) VALUES (?, ?, 7, '2026-10-01T05:00:00Z', '2026-10-01T06:00:00Z')").run(user, JSON.stringify([item]));
  db.transaction(() => db.exec(readFileSync(directory + "0023_server_editions.sql", "utf8")))();
  const edition = db.prepare("SELECT * FROM editions WHERE user_id = ?").get(user)!;
  assert.equal(edition.revision, 7);
  assert.equal(edition.created_at, "2026-10-01T05:00:00Z");
  assert.deepEqual(JSON.parse(edition.item_ids as string), [item]);
  assert.equal(edition.source, "curated");
  assert.equal(edition.status, "active");
  assert.ok(edition.edition_id);
  assert.ok(Date.parse(edition.expires_at as string) > Date.now() + 23 * 3_600_000);
  assert.equal(db.prepare("SELECT content FROM item_notes WHERE user_id = ?").get(user)?.content, "Keep my note");
  assert.equal(db.prepare("SELECT password_hash FROM users WHERE id = ?").get(user)?.password_hash, "unchanged-hash");
  assert.equal(db.prepare("SELECT icon_symbol FROM folders WHERE id = ?").get(folder)?.icon_symbol, "newspaper");
  assert.equal(db.prepare("SELECT count(*) AS n FROM native_preferences").get()?.n, 0);
  assert.equal(db.prepare("SELECT revision FROM edition_history WHERE user_id = ?").get(user)?.revision, 7);
  // Persisted expiry uses a deletion event, and a replacement retains monotonic revision.
  db.prepare("UPDATE editions SET status = 'expired', revision = 8 WHERE user_id = ?").run(user);
  assert.equal(db.prepare("SELECT op FROM changes WHERE user_id = ? AND entity = 'edition'").get(user)?.op, "delete");
  db.prepare("UPDATE editions SET status = 'active', revision = 9 WHERE user_id = ?").run(user);
  assert.equal(db.prepare("SELECT op FROM changes WHERE user_id = ? AND entity = 'edition'").get(user)?.op, "upsert");
  db.close();
});
