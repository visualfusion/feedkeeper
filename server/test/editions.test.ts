import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

process.env.DATABASE_PATH = ":memory:";
process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

test("server editions and app preferences keep devices in step without changing the web reader", async (t) => {
  const { db, runMigrations } = await import("../src/db/index.js");
  const repo = await import("../src/feeds/repository.js");
  const prefs = await import("../src/native/preferences.js");
  const editions = await import("../src/native/editions.js");
  const { NativeError } = await import("../src/native/requests.js");
  const { listChanges, currentSeq } = await import("../src/sync/changeLog.js");
  const { runCleanup } = await import("../src/feeds/cleanup.js");
  const { v1Router } = await import("../src/api/v1/index.js");
  const { createPersonalAccessToken } = await import("../src/auth/tokens.js");
  const { createMcpServerForUser } = await import("../src/mcp/server.js");
  runMigrations();
  let count = 0;
  const now = new Date();
  function user() {
    return Number(db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, 'hash', 'Reader')").run(`reader-${++count}@test.local`).lastInsertRowid);
  }
  function feed(userId: number, folderId: number | null = null) {
    const id = Number(db.prepare("INSERT INTO feeds (url, title) VALUES (?, ?)").run(`https://test.local/feed/${++count}`, `Source ${count}`).lastInsertRowid);
    repo.subscribe(userId, id, null, folderId);
    return id;
  }
  function article(feedId: number, opts: { title?: string; link?: string; age?: number; image?: string; created?: string } = {}) {
    const id = ++count;
    const published = new Date(now.getTime() - (opts.age ?? 0) * 3_600_000).toISOString();
    return Number(db.prepare(`INSERT INTO items (feed_id, guid, title, link, content_snippet, content_html, published_at, created_at, image_url)
      VALUES (?, ?, ?, ?, 'A short report', '<p>A body</p>', ?, ?, ?)`)
      .run(feedId, `guid-${id}`, opts.title ?? `Story ${id}`, opts.link ?? `https://test.local/articles/${id}`, published, opts.created ?? published, opts.image ?? null).lastInsertRowid);
  }
  const isError = (code: string) => (error: unknown) => error instanceof NativeError && error.code === code;

  await t.test("textless media from any publisher are excluded from candidates and publication without changing the library or old issues", () => {
    const owner = user();
    const source = feed(owner);
    const news = article(source);
    const issue = editions.publishCuratedEdition(owner, { itemIds: [news] }, now);
    const media = ["https://www.tagesschau.de/multimedia/video/video-123.html", "https://another.example/watch/456", "https://publisher.example/posts/789"]
      .map(link => article(source, { link }));
    for (const id of media) {
      db.prepare("UPDATE items SET content_snippet = '[mehr]', content_html = '<video src=\"/clip.mp4\"></video>' WHERE id = ?").run(id);
      assert.equal(editions.editionCandidates(owner, now).some(item => item.id === id), false);
      assert.throws(() => editions.publishCuratedEdition(owner, { itemIds: [news, id] }, now), isError("item_excluded"));
      assert.ok(repo.listItemsForUser(owner).some(item => item.id === id));
    }
    assert.deepEqual(editions.getEdition(owner)!.itemIds, issue.itemIds);
    db.prepare("UPDATE items SET full_content_html = '<p>A short transcript of the video.</p>' WHERE id = ?").run(media[0]);
    assert.ok(editions.editionCandidates(owner, now).some(item => item.id === media[0]));
    assert.deepEqual(editions.publishCuratedEdition(owner, { itemIds: [media[0]] }, now).itemIds, [media[0]]);
    db.prepare("UPDATE items SET full_content_html = NULL WHERE id = ?").run(media[0]);
    assert.deepEqual(editions.getEdition(owner)!.itemIds, [media[0]], "existing editions are not rewritten");
  });

  await t.test("preferences are scoped, revision checked, replay safe and independent of web folder ordering", () => {
    const owner = user(), other = user();
    const z = repo.createFolder(owner, "Zulu"), a = repo.createFolder(owner, "Alpha"), foreign = repo.createFolder(other, "Private");
    const before = repo.listFoldersForUser(owner).map((f) => f.id);
    assert.deepEqual(before, [a.id, z.id]);
    assert.equal(prefs.getNativePreferences(owner).revision, 0);
    const input = { requestId: randomUUID(), expectedRevision: 0, folderOrder: [z.id, null, a.id], hiddenFolderIds: [a.id], preferredFolderIds: [z.id], timeZone: "Europe/Berlin" };
    const first = prefs.patchNativePreferences(owner, input);
    assert.equal(first.revision, 1);
    assert.deepEqual(first.folderOrder, [z.id, null, a.id]);
    assert.deepEqual(repo.listFoldersForUser(owner).map((f) => f.id), before);
    assert.equal(prefs.getNativePreferences(other).revision, 0);
    const second = prefs.patchNativePreferences(owner, { requestId: randomUUID(), expectedRevision: 1, editionSize: 12 });
    assert.equal(second.revision, 2);
    assert.deepEqual(prefs.patchNativePreferences(owner, input), first, "late retry returns original result");
    assert.equal(prefs.getNativePreferences(owner).editionSize, 12);
    assert.throws(() => prefs.patchNativePreferences(owner, { ...input, editionSize: 8 }), isError("request_id_reused"));
    assert.throws(() => prefs.patchNativePreferences(owner, { requestId: randomUUID(), expectedRevision: 1, hiddenFolderIds: [] }), isError("revision_conflict"));
    assert.throws(() => prefs.patchNativePreferences(owner, { requestId: randomUUID(), expectedRevision: 2, folderOrder: [foreign.id] }), isError("folder_not_found"));
    assert.throws(() => prefs.patchNativePreferences(owner, { requestId: randomUUID(), expectedRevision: 2, timeZone: "invalid/zone" }), isError("invalid_input"));
    assert.throws(() => prefs.patchNativePreferences(owner, { requestId: randomUUID(), expectedRevision: 2, hiddenFolderIds: [a.id, a.id] }), isError("invalid_input"));
    assert.throws(() => prefs.patchNativePreferences(owner, { requestId: randomUUID(), expectedRevision: 2, unknown: true } as never), isError("invalid_input"));
    repo.updateFolder(owner, z.id, "Renamed");
    assert.deepEqual(prefs.getNativePreferences(owner).folderOrder, [z.id, null, a.id]);
    const cursor = currentSeq(owner);
    repo.deleteFolder(owner, a.id);
    const pruned = prefs.getNativePreferences(owner);
    assert.equal(pruned.revision, 3);
    assert.deepEqual(pruned.hiddenFolderIds, []);
    assert.deepEqual(pruned.folderOrder, [z.id, null]);
    assert.equal(listChanges(owner, cursor).changes.find((c) => c.entity === "native_preferences")?.data?.revision, 3);
    const newFolder = repo.createFolder(owner, "Alpha");
    assert.ok(!pruned.folderOrder.includes(newFolder.id));
    assert.equal(listChanges(owner, 0, 1).changes.length, 1);
  });

  await t.test("article count defaults are independent of folder changes and reset explicitly", () => {
    const owner = user();
    let value = prefs.patchNativePreferences(owner, { requestId: randomUUID(), expectedRevision: 0, timeZone: "Europe/Berlin" });
    assert.equal(value.editionSizeIsCustom, false);
    value = prefs.patchNativePreferences(owner, { requestId: randomUUID(), expectedRevision: value.revision, editionSize: 24 });
    assert.equal(value.editionSizeIsCustom, true, "explicit 24 differs from the inherited default");
    value = prefs.patchNativePreferences(owner, { requestId: randomUUID(), expectedRevision: value.revision, editionSize: null });
    assert.equal(value.editionSizeIsCustom, false);
    assert.equal(value.editionSize, 24);
    db.prepare("UPDATE native_preferences SET settings = json_remove(settings, '$.editionSizeIsCustom') WHERE user_id = ?").run(owner);
    assert.equal(prefs.getNativePreferences(owner).editionSizeIsCustom, false);
    db.prepare("UPDATE native_preferences SET settings = json_set(settings, '$.editionSize', 8) WHERE user_id = ?").run(owner);
    assert.equal(prefs.getNativePreferences(owner).editionSizeIsCustom, true);
  });

  await t.test("linked overviews persist, replay and sync without permitting foreign references", async () => {
    const owner = user(), source = feed(owner), a = article(source), b = article(source);
    const overview = [{ heading: "Concrete development", segments: [{ text: "A report by " }, { text: "Source", itemId: a }] }];
    const input = { itemIds: [a], overview, requestId: randomUUID(), expectedRevision: 0 };
    const first = editions.publishCuratedEdition(owner, input, now);
    assert.deepEqual(first.overview, [{ id: "topic-1", ...overview[0] }]);
    assert.equal(first.summary, "Concrete development: A report by Source");
    assert.deepEqual(editions.publishCuratedEdition(owner, input, now), first);
    assert.deepEqual(editions.getEdition(owner, now)?.overview, first.overview);
    assert.deepEqual(listChanges(owner, 0).changes.find(c => c.entity === "edition")?.data?.overview, first.overview);
    assert.throws(() => editions.publishCuratedEdition(owner, { itemIds: [a], overview: [{ heading: "Other", segments: [{ text: "Foreign", itemId: b }] }] }, now), isError("invalid_overview_reference"));
    assert.throws(() => editions.publishCuratedEdition(owner, { itemIds: [a], overview: [{ heading: "Unlinked", segments: [{ text: "Text" }] }] }, now), isError("invalid_overview_reference"));
    const { cachedEditionSources } = await import("../src/native/editionText.js");
    db.prepare("UPDATE items SET full_content_html = '<p>Specific &amp; factual.</p><script>ignored secret</script>' WHERE id = ?").run(a);
    const text = cachedEditionSources(owner, [a])[0];
    assert.ok(text.text.includes("Specific & factual."));
    assert.ok(!text.text.includes("ignored secret"));
    assert.equal(text.textKind, "reader");
    assert.throws(() => cachedEditionSources(user(), [a]), /item_not_found/);
  });

  await t.test("layouts persist with the issue, replay and sync, and are checked against it", () => {
    const owner = user(), source = feed(owner);
    const [a, b, c, d] = [article(source), article(source), article(source), article(source)];
    const overview = [{ heading: "Topic", segments: [{ text: "See " }, { text: "source", itemId: b }] }];
    const layout = {
      version: 1 as const, character: "dominant" as const,
      blocks: [
        { type: "lead" as const, itemId: a, kicker: "Aviation" },
        { type: "dossier" as const, topic: 1, itemIds: [b] },
        { type: "standard" as const, stories: [{ itemId: c }] },
      ],
    };
    const input = { itemIds: [a, b, c, d], overview, layout, requestId: randomUUID(), expectedRevision: 0 };
    const first = editions.publishCuratedEdition(owner, input, now);
    assert.deepEqual(first.layout, layout);
    assert.deepEqual(editions.publishCuratedEdition(owner, input, now), first);
    assert.deepEqual(editions.getEdition(owner, now)?.layout, layout);
    assert.deepEqual(listChanges(owner, 0).changes.find(c => c.entity === "edition")?.data?.layout, layout);

    const publish = (changes: Record<string, unknown>) => editions.publishCuratedEdition(owner, { itemIds: [a, b, c, d], overview, ...changes } as never, now);
    const withBlocks = (blocks: unknown[]) => ({ layout: { ...layout, blocks } });
    assert.throws(() => publish(withBlocks([{ type: "banner", itemId: a }])), isError("invalid_layout"), "unknown block types are rejected when publishing");
    assert.throws(() => publish(withBlocks([{ type: "lead", itemId: a, colour: "red" }])), isError("invalid_layout"), "unknown fields are rejected");
    assert.throws(() => publish({ layout: { ...layout, character: "loud" } }), isError("invalid_layout"));
    assert.throws(() => publish({ layout: { ...layout, version: 2 } }), isError("invalid_layout"));
    assert.throws(() => publish(withBlocks([{ type: "lead", itemId: a, kicker: "A full sentence." }])), isError("invalid_layout"), "a kicker is a label, not a sentence");
    assert.throws(() => publish(withBlocks([{ type: "briefs", itemIds: [a] }])), isError("invalid_layout"), "briefs need at least two stories");
    assert.throws(() => publish(withBlocks([])), isError("invalid_layout"));
    assert.throws(() => publish(withBlocks([{ type: "feature", itemId: a }, { type: "lead", itemId: b }])), isError("invalid_layout"), "the lead stands first");
    assert.throws(() => publish(withBlocks([{ type: "feature", itemId: a }, { type: "photo", itemId: a }])), isError("invalid_layout"), "a story appears once");
    assert.throws(() => publish(withBlocks([{ type: "dossier", topic: 1, itemIds: [a] }, { type: "dossier", topic: 1, itemIds: [b] }])), isError("invalid_layout"), "a topic has one dossier");
    assert.throws(() => publish(withBlocks([{ type: "feature", itemId: article(source) }])), isError("invalid_layout_reference"), "stories must be part of the issue");
    assert.throws(() => publish(withBlocks([{ type: "dossier", topic: 2, itemIds: [a] }])), isError("invalid_layout_reference"), "a dossier needs its topic in the overview");
    assert.throws(() => editions.publishCuratedEdition(owner, { itemIds: [a], layout: { version: 1, character: "calm", blocks: [{ type: "dossier", topic: 1, itemIds: [a] }] } }, now), isError("invalid_layout_reference"), "no overview, no dossier");

    const plain = editions.publishCuratedEdition(owner, { itemIds: [a, b] }, now);
    assert.equal(plain.layout, null, "an issue without a plan carries none");
    assert.equal(editions.getEdition(owner, now)?.layout, null);
  });

  await t.test("preferences and candidates never publish an edition", () => {
    const owner = user(), source = feed(owner);
    article(source);
    prefs.patchNativePreferences(owner, { requestId: randomUUID(), expectedRevision: 0, readingMinutes: 5 });
    assert.ok(editions.editionCandidates(owner, now, 24).length > 0);
    assert.equal(editions.getEdition(owner, now), null);
    assert.equal(editions.getEditionState(owner, now).revision, 0);
  });

  await t.test("curation is finite, protected from automation and publishes atomically with receipts", () => {
    const owner = user(), source = feed(owner), a = article(source), b = article(source);
    const input = { itemIds: [b, a], expectedRevision: 0, requestId: randomUUID(), title: "My selection", summary: "A short introduction" };
    const first = editions.publishCuratedEdition(owner, input, now);
    assert.equal(Date.parse(first.expiresAt) - now.getTime(), 24 * 3_600_000);
    assert.deepEqual(first.itemIds, [b, a]);
    assert.equal(editions.getEdition(owner, now)?.id, first.id);
    assert.throws(() => editions.publishCuratedEdition(owner, { itemIds: [a], expectedRevision: 0 }, now), isError("revision_conflict"));
    assert.throws(() => editions.publishCuratedEdition(owner, { itemIds: [a, a] }, now), isError("duplicate_item_ids"));
    assert.throws(() => editions.publishCuratedEdition(owner, { itemIds: [a], expiresAt: now.toISOString() }, now), isError("invalid_expiry"));
    assert.throws(() => editions.publishCuratedEdition(owner, { itemIds: [a], expiresAt: new Date(now.getTime() + 1000).toISOString(), durationHours: 12 }, now), isError("invalid_input"));
    const second = editions.publishCuratedEdition(owner, { itemIds: [a], expectedRevision: 1 }, new Date(now.getTime() + 1000));
    assert.notEqual(second.id, first.id);
    assert.notEqual(second.createdAt, first.createdAt);
    assert.equal(second.revision, 2);
    assert.deepEqual(editions.publishCuratedEdition(owner, input, now), first);
    assert.equal(editions.getEdition(owner, now)?.id, second.id);
    const dismissed = editions.dismissEdition(owner, { expectedRevision: 2, requestId: randomUUID() }, now);
    assert.equal(dismissed.revision, 3);
    assert.equal(dismissed.status, "dismissed");
    assert.equal(editions.getEdition(owner, now), null, "explicit dismissal is respected");
    const fresh = editions.publishCuratedEdition(owner, { itemIds: [a], expectedRevision: 3 }, now);
    assert.equal(fresh.revision, 4);
    const cursor = currentSeq(owner);
    editions.dismissEdition(owner, { expectedRevision: 4 }, now);
    const change = listChanges(owner, cursor).changes.find((c) => c.entity === "edition")!;
    assert.equal(change.op, "delete");
    assert.equal(change.data?.revision, 5);
    assert.equal(editions.getEditionState(owner, now).revision, 5);
  });

  await t.test("expiry keeps the last curated publication readable and creates no replacement", () => {
    const owner = user(), source = feed(owner), selected = article(source);
    const first = editions.publishCuratedEdition(owner, { itemIds: [selected], durationHours: 0.001 }, now);
    const sequence = currentSeq(owner);
    const later = new Date(now.getTime() + 10_000);
    article(source);
    assert.equal(editions.getEditionState(owner, later).status, "expired", "curators can publish the next scheduled issue");
    assert.equal(editions.getEditionState(owner, later).revision, first.revision);
    assert.deepEqual(editions.getEdition(owner, later), first, "readers keep the exact issue, including its original period");
    assert.equal(listChanges(owner, 0).changes.find((c) => c.entity === "edition")?.op, "upsert");
    assert.equal(currentSeq(owner), sequence, "checking expiry does not write or generate anything");
  });

  await t.test("the last curated issue survives cleanup and unsubscribing until explicitly dismissed", () => {
    const owner = user(), source = feed(owner);
    const selected = article(source, { age: 100 * 24 });
    const discarded = article(source, { age: 90 * 24 });
    article(source);
    editions.publishCuratedEdition(owner, { itemIds: [selected] }, now);
    repo.markItemRead(owner, selected);
    runCleanup({ retentionReadDays: 1, retentionMaxDays: 1, retentionMaxItemsPerFeed: 1 });
    assert.ok(db.prepare("SELECT 1 FROM items WHERE id = ?").get(selected));
    assert.equal(db.prepare("SELECT 1 FROM items WHERE id = ?").get(discarded), undefined);
    repo.unsubscribe(owner, source);
    assert.ok(repo.canAccessItem(owner, selected));
    assert.ok(repo.findItemForUser(owner, selected));
    assert.ok(repo.findFeedById(source));
    assert.equal(repo.canAccessItem(user(), selected), false);
    editions.dismissEdition(owner, {}, now);
    runCleanup({ retentionReadDays: 1, retentionMaxDays: 1, retentionMaxItemsPerFeed: 1 });
    assert.equal(db.prepare("SELECT 1 FROM items WHERE id = ?").get(selected), undefined);
  });

  await t.test("HTTP contracts, read-only scopes, ordered payloads and conditional deletion", async () => {
    const owner = user(), source = feed(owner), a = article(source), b = article(source);
    const writer = createPersonalAccessToken(owner, "writer", "write").token;
    const reader = createPersonalAccessToken(owner, "reader", "read").token;
    const app = express(); app.use(express.json()); app.use("/api/v1", v1Router);
    const server = app.listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
    const call = async (path: string, method = "GET", body?: object, token = writer) => {
      const response = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const text = await response.text();
      return { status: response.status, body: text && response.headers.get("content-type")?.includes("application/json") ? JSON.parse(text) : null };
    };
    try {
      assert.equal((await call("/edition")).status, 404);
      assert.equal((await call("/edition/state")).body.revision, 0);
      assert.equal((await call("/edition/state")).body.status, "none");
      assert.equal((await call("/native-preferences")).body.revision, 0);
      assert.equal((await call("/edition/generate", "POST", { requestId: randomUUID() }, reader)).status, 403);
      assert.equal((await call("/native-preferences", "PATCH", { requestId: randomUUID(), expectedRevision: 0 }, reader)).status, 403);
      assert.equal((await call("/edition/generate", "POST", { requestId: randomUUID() })).status, 404);
      const curated = editions.publishCuratedEdition(owner, { itemIds: [b, a], expectedRevision: 0 });
      assert.deepEqual((await call("/edition")).body.items.map((item: { id: number }) => item.id), [b, a]);
      const ensured = await call("/edition/generate", "POST", { requestId: randomUUID(), force: true, expectedRevision: curated.revision });
      assert.equal(ensured.status, 200);
      assert.equal(ensured.body.id, curated.id);
      assert.equal(editions.getEditionState(owner).revision, curated.revision, "legacy ensure requests never publish or replace an issue");
      assert.equal((await call("/edition/candidates?limit=1")).body.candidates.length, 1);
      assert.equal((await call("/edition/candidates?limit=201")).status, 400);
      assert.equal((await call("/edition", "DELETE", { expectedRevision: 0, requestId: randomUUID() })).status, 409);
      assert.equal((await call("/edition", "DELETE", { expectedRevision: curated.revision, requestId: randomUUID() })).status, 204);
      assert.equal((await call("/edition")).status, 404);
      assert.equal((await call("/native-preferences", "PATCH", { requestId: randomUUID(), expectedRevision: 0, folderOrder: [123456] })).status, 404);
    } finally { server.close(); }
  });

  await t.test("MCP reads preferences and candidates and reports revision conflicts without writes", async () => {
    const owner = user(), source = feed(owner), a = article(source);
    const connect = async (scope: "read" | "write") => {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const server = createMcpServerForUser(owner, scope);
      const client = new Client({ name: "edition-test", version: "1" });
      await server.connect(serverTransport); await client.connect(clientTransport);
      return { client, server };
    };
    const writer = await connect("write"), reader = await connect("read");
    try {
      const tools = (await reader.client.listTools()).tools.map((tool) => tool.name);
      assert.ok(tools.includes("get_edition") && tools.includes("get_edition_candidates") && tools.includes("get_native_preferences"));
      for (const name of ["publish_edition", "generate_edition", "dismiss_edition", "update_native_preferences"]) assert.ok(!tools.includes(name));
      const id = randomUUID();
      const overview = [{heading: "Original report", segments: [{text: "Source report", itemId: a}]}];
      const first = await writer.client.callTool({ name: "publish_edition", arguments: { itemIds: [a], requestId: id, expectedRevision: 0, overview } });
      assert.equal(first.isError, undefined);
      assert.equal(editions.getEdition(owner)?.overview?.[0].segments[0].itemId, a);
      const second = await writer.client.callTool({ name: "publish_edition", arguments: { itemIds: [a], requestId: randomUUID(), expectedRevision: 0 } });
      assert.equal(second.isError, true);
      const conflict = JSON.parse((second.content as { text: string }[])[0].text);
      assert.equal(conflict.error, "revision_conflict");
      assert.equal(conflict.current.revision, 1);
      assert.deepEqual(await writer.client.callTool({ name: "publish_edition", arguments: { itemIds: [a], requestId: id, expectedRevision: 0, overview } }), first);
    } finally {
      for (const session of [writer, reader]) { await session.client.close(); await session.server.close(); }
    }
  });
});

test("edition boundaries follow user zones, including DST and a late issue spanning midnight", async () => {
  const { editionPeriod, nextEditionBoundary, canonicalArticleUrl } = await import("../src/native/editionSelection.js");
  assert.equal(editionPeriod(new Date("2026-10-03T21:00:00Z"), "Europe/Berlin").key, editionPeriod(new Date("2026-10-04T00:00:00Z"), "Europe/Berlin").key);
  assert.equal(nextEditionBoundary(new Date("2026-03-28T22:30:00Z"), "Europe/Berlin").toISOString(), "2026-03-29T03:00:00.000Z");
  assert.equal(nextEditionBoundary(new Date("2026-10-24T22:30:00Z"), "Europe/Berlin").toISOString(), "2026-10-25T04:00:00.000Z");
  assert.equal(nextEditionBoundary(new Date("2026-10-04T04:20:59Z"), "Asia/Kolkata").toISOString(), "2026-10-04T05:30:00.000Z");
  assert.equal(canonicalArticleUrl("https://example.test/story?id=3&utm_source=rss#top"), "https://example.test/story?id=3");
  assert.notEqual(canonicalArticleUrl("https://example.test/story?id=3"), canonicalArticleUrl("https://example.test/story?id=4"));
});
