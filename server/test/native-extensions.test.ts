import assert from "node:assert/strict";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";

process.env.DATABASE_PATH = ":memory:";
process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

test("native extensions: feed icons, folder icons, notes, editions, and retention", async () => {
  const { db, runMigrations } = await import("../src/db/index.js");
  const { storeFeedIcon } = await import("../src/feeds/feedIcon.js");
  const { runCleanup } = await import("../src/feeds/cleanup.js");
  const { findItemNote } = await import("../src/feeds/repository.js");
  const { listChanges } = await import("../src/sync/changeLog.js");
  const { applyMutations } = await import("../src/sync/mutations.js");
  const { v1Router } = await import("../src/api/v1/index.js");
  const { createPersonalAccessToken } = await import("../src/auth/tokens.js");
  runMigrations();

  const unique = Date.now();
  const addUser = db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, 'hash', ?)");
  const user1 = Number(addUser.run(`ext-user1-${unique}@test.local`, "User One").lastInsertRowid);
  const user2 = Number(addUser.run(`ext-user2-${unique}@test.local`, "User Two").lastInsertRowid);

  const token1 = createPersonalAccessToken(user1, "Device 1", "write").token;
  const token2 = createPersonalAccessToken(user2, "Device 2", "write").token;

  const app = express();
  app.use(express.json());
  app.use("/api/v1", v1Router);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;

  const call = async (
    path: string,
    token: string | null,
    init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  ) => {
    const headers: Record<string, string> = { "content-type": "application/json", ...init.headers };
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetch(base + path, {
      method: init.method ?? "GET",
      headers,
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const type = response.headers.get("content-type") ?? "";
    const body = type.includes("application/json") ? await response.json() : await response.text();
    return { status: response.status, body, headers: response.headers };
  };

  try {
    // 1. Meta endpoint includes new feature flags
    const metaRes = await call("/meta", token1);
    assert.equal(metaRes.status, 200);
    const features = (metaRes.body as { features: string[] }).features;
    assert.ok(features.includes("feed-icons"));
    assert.ok(features.includes("folder-icons"));
    assert.ok(features.includes("notes"));
    assert.ok(features.includes("edition"));

    // 2. Folder icons and validation
    const invalidFolderRes = await call("/folders", token1, {
      method: "POST",
      body: { name: "Tech", iconSymbol: "invalid symbol with spaces!" },
    });
    assert.equal(invalidFolderRes.status, 400);

    const createdFolderRes = await call("/folders", token1, {
      method: "POST",
      body: { name: "Tech", iconSymbol: "newspaper.fill" },
    });
    assert.equal(createdFolderRes.status, 201);
    const folder = createdFolderRes.body as { id: number; name: string; iconSymbol: string };
    assert.equal(folder.name, "Tech");
    assert.equal(folder.iconSymbol, "newspaper.fill");
    const folderId = folder.id;

    // Rename folder preserves iconSymbol
    const patchedNameRes = await call(`/folders/${folderId}`, token1, {
      method: "PATCH",
      body: { name: "Technology" },
    });
    assert.equal(patchedNameRes.status, 200);
    assert.equal((patchedNameRes.body as { name: string; iconSymbol: string }).name, "Technology");
    assert.equal((patchedNameRes.body as { name: string; iconSymbol: string }).iconSymbol, "newspaper.fill");

    // Update iconSymbol
    const patchedIconRes = await call(`/folders/${folderId}`, token1, {
      method: "PATCH",
      body: { iconSymbol: "cpu" },
    });
    assert.equal(patchedIconRes.status, 200);
    assert.equal((patchedIconRes.body as { iconSymbol: string }).iconSymbol, "cpu");

    // Check sync change log for folder
    const folderChanges = listChanges(user1, 0).changes.filter((c) => c.entity === "folder" && c.id === folderId);
    assert.ok(folderChanges.length > 0);
    assert.equal((folderChanges[folderChanges.length - 1].data as { iconSymbol: string }).iconSymbol, "cpu");

    // 3. Subscriptions & Feed Icons
    const feedId = Number(
      db
        .prepare("INSERT INTO feeds (url, title, site_url, icon_url) VALUES (?, ?, ?, ?)")
        .run(`https://example.com/feed-${unique}.xml`, "Example News", "https://example.com", "https://example.com/icon.png")
        .lastInsertRowid,
    );
    db.prepare("INSERT INTO subscriptions (user_id, feed_id, folder_id, position) VALUES (?, ?, ?, ?)").run(user1, feedId, folderId, 0);

    // Store feed icon in DB
    const fakePng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137]);
    const storedIcon = storeFeedIcon(feedId, fakePng, "image/png");
    assert.ok(storedIcon.hash);

    // User 1 can access icon
    const iconRes = await call(`/subscriptions/${feedId}/icon?v=${storedIcon.hash}`, token1);
    assert.equal(iconRes.status, 200);
    assert.equal(iconRes.headers.get("etag"), `"${storedIcon.hash}"`);
    assert.ok(iconRes.headers.get("cache-control")?.includes("immutable"));

    // ETag conditional request
    const etagRes = await call(`/subscriptions/${feedId}/icon`, token1, {
      headers: { "if-none-match": `"${storedIcon.hash}"` },
    });
    assert.equal(etagRes.status, 304);

    // User 2 cannot access icon (not subscribed)
    const forbiddenIconRes = await call(`/subscriptions/${feedId}/icon`, token2);
    assert.equal(forbiddenIconRes.status, 404);

    // Subscriptions in sync log include iconHash and versioned iconUrl
    const subChanges = listChanges(user1, 0).changes.filter((c) => c.entity === "subscription" && c.id === feedId);
    assert.ok(subChanges.length > 0);
    const subData = subChanges[subChanges.length - 1].data as { iconHash: string; iconUrl: string };
    assert.equal(subData.iconHash, storedIcon.hash);
    assert.equal(subData.iconUrl, `/api/v1/subscriptions/${feedId}/icon?v=${storedIcon.hash}`);

    // An unchanged icon does not create another sync event; SVG is rasterized for native clients.
    const previousIconSeq = subChanges[subChanges.length - 1].seq;
    storeFeedIcon(feedId, fakePng, "image/png");
    assert.equal(listChanges(user1, 0).changes.filter((c) => c.entity === "subscription" && c.id === feedId).at(-1)?.seq, previousIconSeq);
    const svgIcon = storeFeedIcon(feedId, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>'), "image/svg+xml");
    assert.equal(svgIcon.mime, "image/png");
    assert.equal(svgIcon.buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    const rasterRes = await call(`/subscriptions/${feedId}/icon?v=${svgIcon.hash}`, token1);
    assert.equal(rasterRes.headers.get("content-type"), "image/png");
    assert.equal((listChanges(user1, 0).changes.filter((c) => c.entity === "subscription" && c.id === feedId).at(-1)?.data as { iconHash: string }).iconHash, svgIcon.hash);

    // 4. Articles and Article Notes
    const itemId = Number(
      db
        .prepare("INSERT INTO items (feed_id, guid, title, link, content_snippet, published_at, created_at) VALUES (?, ?, ?, ?, 'A short news report for the curated edition.', ?, ?)")
        .run(feedId, "item-1", "Test Article 1", "https://example.com/item1", new Date().toISOString(), new Date().toISOString())
        .lastInsertRowid,
    );

    // Article initially has hasNote: false in list
    const itemsBeforeRes = await call("/items", token1);
    assert.equal(itemsBeforeRes.status, 200);
    const itemsList = (itemsBeforeRes.body as { items: { id: number; state: { hasNote: boolean } }[] }).items;
    const itemBefore = itemsList.find((i) => i.id === itemId);
    assert.ok(itemBefore);
    assert.equal(itemBefore.state.hasNote, false);

    // Create note via PUT /items/:id/note
    const noteRes = await call(`/items/${itemId}/note`, token1, {
      method: "PUT",
      body: { content: "Great article about tech!" },
    });
    assert.equal(noteRes.status, 200);
    const noteBody = noteRes.body as { content: string; revision: number };
    assert.equal(noteBody.content, "Great article about tech!");
    assert.equal(noteBody.revision, 1);

    // Article now has hasNote: true in list
    const itemsAfterRes = await call("/items", token1);
    const itemsAfterList = (itemsAfterRes.body as { items: { id: number; state: { hasNote: boolean } }[] }).items;
    const itemAfter = itemsAfterList.find((i) => i.id === itemId);
    assert.ok(itemAfter);
    assert.equal(itemAfter.state.hasNote, true);

    // GET /items/:id/note
    const getNoteRes = await call(`/items/${itemId}/note`, token1);
    assert.equal(getNoteRes.status, 200);
    assert.equal((getNoteRes.body as { content: string; revision: number }).content, "Great article about tech!");
    assert.equal((getNoteRes.body as { content: string; revision: number }).revision, 1);

    // Optimistic concurrency conflict on PUT: mismatch expectedRevision
    const conflictRes = await call(`/items/${itemId}/note`, token1, {
      method: "PUT",
      body: { content: "Conflicting edit", expectedRevision: 0 },
    });
    assert.equal(conflictRes.status, 409);
    assert.equal((conflictRes.body as { error: string }).error, "revision_conflict");
    assert.equal((conflictRes.body as { current: { revision: number } }).current.revision, 1);

    // Successful edit with matching expectedRevision
    const updatedNoteRes = await call(`/items/${itemId}/note`, token1, {
      method: "PUT",
      body: { content: "Updated note content", expectedRevision: 1 },
    });
    assert.equal(updatedNoteRes.status, 200);
    assert.equal((updatedNoteRes.body as { revision: number }).revision, 2);
    assert.equal((updatedNoteRes.body as { content: string }).content, "Updated note content");

    // Single note Markdown endpoint
    const noteMdRes = await call(`/items/${itemId}/note.md`, token1);
    assert.equal(noteMdRes.status, 200);
    assert.ok(noteMdRes.headers.get("content-type")?.includes("text/markdown"));
    assert.ok((noteMdRes.body as string).includes("Test Article 1"));
    assert.ok((noteMdRes.body as string).includes("Updated note content"));

    // Export all notes Markdown endpoint
    const notesExportRes = await call("/notes/export", token1);
    assert.equal(notesExportRes.status, 200);
    assert.ok(notesExportRes.headers.get("content-type")?.includes("text/markdown"));
    assert.ok((notesExportRes.body as string).includes("FeedKeeper Notes"));
    assert.ok((notesExportRes.body as string).includes("Test Article 1"));

    // Check sync change log for note
    const noteChanges = listChanges(user1, 0).changes.filter((c) => c.entity === "note" && c.id === itemId);
    assert.ok(noteChanges.length > 0);
    const noteData = noteChanges[noteChanges.length - 1].data as { content: string; revision: number };
    assert.equal(noteData.content, "Updated note content");
    assert.equal(noteData.revision, 2);

    // Offline mutations: test note set and conflict
    const mutationResults = applyMutations(user1, [
      {
        id: "mut-note-conflict",
        at: new Date().toISOString(),
        type: "item.note.set",
        itemId,
        content: "Offline rewrite",
        expectedRevision: 1, // Current is 2, so this must conflict!
      },
    ]);
    assert.equal(mutationResults[0].outcome, "conflict");
    assert.equal(mutationResults[0].current?.revision, 2);

    // Offline mutation with valid revision
    const appliedMutation = applyMutations(user1, [
      {
        id: "mut-note-ok",
        at: new Date().toISOString(),
        type: "item.note.set",
        itemId,
        content: "Offline note synchronized",
        expectedRevision: 2,
      },
    ]);
    assert.equal(appliedMutation[0].outcome, "applied");
    assert.equal(findItemNote(user1, itemId)?.content, "Offline note synchronized");

    // A stale device cannot delete a newer note or overwrite a note recreated after deletion.
    const staleDelete = await call(`/items/${itemId}/note`, token1, { method: "DELETE", body: { expectedRevision: 2 } });
    assert.equal(staleDelete.status, 409);
    assert.equal((staleDelete.body as { current: { revision: number } }).current.revision, 3);
    const deletedNote = await call(`/items/${itemId}/note`, token1, { method: "DELETE", body: { expectedRevision: 3 } });
    assert.equal(deletedNote.status, 204);
    const missingNote = await call(`/items/${itemId}/note`, token1);
    assert.equal(missingNote.status, 404);
    assert.deepEqual((missingNote.body as { current: { revision: number; deleted: boolean; content: null } }).current.revision, 4);
    assert.equal((missingNote.body as { current: { deleted: boolean } }).current.deleted, true);
    const deletedChange = listChanges(user1, 0).changes.filter((c) => c.entity === "note" && c.id === itemId).at(-1);
    assert.equal(deletedChange?.op, "delete");
    assert.equal((deletedChange?.data as { revision: number }).revision, 4);

    const staleRecreate = await call(`/items/${itemId}/note`, token1, {
      method: "PUT", body: { content: "Old offline edit", expectedRevision: 3 },
    });
    assert.equal(staleRecreate.status, 409);
    assert.equal((staleRecreate.body as { current: { revision: number; deleted: boolean } }).current.revision, 4);
    assert.equal((staleRecreate.body as { current: { deleted: boolean } }).current.deleted, true);
    const recreatedNote = await call(`/items/${itemId}/note`, token1, {
      method: "PUT", body: { content: "Recreated note", expectedRevision: 4 },
    });
    assert.equal(recreatedNote.status, 200);
    assert.equal((recreatedNote.body as { revision: number }).revision, 5);
    const staleOfflineDelete = applyMutations(user1, [{
      id: "mut-note-stale-delete", at: new Date().toISOString(), type: "item.note.delete", itemId, expectedRevision: 3,
    }]);
    assert.equal(staleOfflineDelete[0].outcome, "conflict");
    assert.equal(staleOfflineDelete[0].current?.revision, 5);
    const offlineDelete = {
      id: "mut-note-valid-delete", at: new Date().toISOString(), type: "item.note.delete", itemId, expectedRevision: 5,
    };
    assert.equal(applyMutations(user1, [offlineDelete])[0].outcome, "applied");
    assert.equal(applyMutations(user1, [offlineDelete])[0].outcome, "duplicate");
    assert.equal((listChanges(user1, 0).changes.filter((c) => c.entity === "note" && c.id === itemId).at(-1)?.data as { revision: number }).revision, 6);
    const finalNote = await call(`/items/${itemId}/note`, token1, {
      method: "PUT", body: { content: "Recreated note", expectedRevision: 6 },
    });
    assert.equal(finalNote.status, 200);
    assert.equal((finalNote.body as { revision: number }).revision, 7);

    // 5. Retention protection for items with notes
    // Mark item as read and make it old
    db.prepare("INSERT INTO item_reads (user_id, item_id, read_at) VALUES (?, ?, ?)").run(user1, itemId, "2020-01-01T00:00:00Z");
    db.prepare("UPDATE items SET created_at = '2020-01-01T00:00:00Z', published_at = '2020-01-01T00:00:00Z' WHERE id = ?").run(itemId);

    // Also create a second old item WITHOUT a note
    const itemId2 = Number(
      db
        .prepare("INSERT INTO items (feed_id, guid, title, link, published_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(feedId, "item-2", "Old Article Without Note", "https://example.com/item2", "2020-01-01T00:00:00Z", "2020-01-01T00:00:00Z")
        .lastInsertRowid,
    );
    db.prepare("INSERT INTO item_reads (user_id, item_id, read_at) VALUES (?, ?, ?)").run(user1, itemId2, "2020-01-01T00:00:00Z");

    // Run cleanup with aggressive retention (readDays: 1, maxDays: 1)
    runCleanup({ retentionReadDays: 1, retentionMaxDays: 1 });

    // itemId2 without note was deleted by cleanup
    assert.equal(db.prepare("SELECT 1 FROM items WHERE id = ?").get(itemId2), undefined);
    // itemId WITH note was preserved by retention cleanup!
    assert.ok(db.prepare("SELECT 1 FROM items WHERE id = ?").get(itemId));

    // 6. Curated Edition ("Deine Zeitung")
    // Test publishing via MCP tool publish_edition
    const { createMcpServerForUser } = await import("../src/mcp/server.js");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpServer = createMcpServerForUser(user1, "write");
    const client = new Client({ name: "feedkeeper-test", version: "1.0" });
    await mcpServer.connect(serverTransport);
    await client.connect(clientTransport);

    // MCP: duplicate itemIds rejected
    const dupRes = await client.callTool({ name: "publish_edition", arguments: { itemIds: [itemId, itemId] } });
    assert.equal(dupRes.isError, true);

    // MCP: foreign/inaccessible itemIds rejected
    db
      .prepare("INSERT INTO items (feed_id, guid, title, link, published_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(feedId, "item-foreign", "Foreign Item", "https://example.com/foreign", new Date().toISOString(), new Date().toISOString());
    // User 2 cannot publish User 1's feed item unless subscribed
    const [c2Transport, s2Transport] = InMemoryTransport.createLinkedPair();
    const mcpServer2 = createMcpServerForUser(user2, "write");
    const client2 = new Client({ name: "feedkeeper-test-2", version: "1.0" });
    await mcpServer2.connect(s2Transport);
    await client2.connect(c2Transport);
    const foreignRes = await client2.callTool({ name: "publish_edition", arguments: { itemIds: [itemId] } });
    assert.equal(foreignRes.isError, true);
    await client2.close();

    // MCP: valid publish_edition
    const pubRes = await client.callTool({
      name: "publish_edition",
      arguments: { itemIds: [itemId], durationHours: 24 },
    });
    assert.equal(pubRes.isError, undefined);
    const mcpEdition = JSON.parse((pubRes.content as { text: string }[])[0].text);
    assert.equal(mcpEdition.revision, 1);
    assert.deepEqual(mcpEdition.itemIds, [itemId]);
    assert.ok(mcpEdition.expiresAt);
    await client.close();

    // GET /api/v1/edition
    const editionRes = await call("/edition", token1);
    assert.equal(editionRes.status, 200);
    const editionBody = editionRes.body as { revision: number; items: { id: number; state: { hasNote: boolean } }[] };
    assert.equal(editionBody.revision, 1);
    assert.equal(editionBody.items.length, 1);
    assert.equal(editionBody.items[0].id, itemId);
    assert.equal(editionBody.items[0].state.hasNote, true);

    // Sync change log has edition entity
    const editionChanges = listChanges(user1, 0).changes.filter((c) => c.entity === "edition");
    assert.ok(editionChanges.length > 0);
    assert.equal((editionChanges[editionChanges.length - 1].data as { revision: number }).revision, 1);

    // DELETE /api/v1/edition
    const deleteEditionRes = await call("/edition", token1, { method: "DELETE" });
    assert.equal(deleteEditionRes.status, 204);
    const getDeletedEditionRes = await call("/edition", token1);
    assert.equal(getDeletedEditionRes.status, 404);

    // 7. Full-text search (GET /api/v1/search)
    // Insert an item with unique full content
    const searchableItemId = Number(
      db
        .prepare(
          "INSERT INTO items (feed_id, guid, title, link, content_snippet, full_content_html, published_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          feedId,
          "fts-item-1",
          "Quantum Computing Innovations",
          "https://example.com/quantum",
          "Snippet about qubits",
          "<p>Detailed breakthrough in superconductivity physics</p>",
          new Date().toISOString(),
          new Date().toISOString(),
        ).lastInsertRowid,
    );

    // Search by title keyword
    const searchTitleRes = await call("/search?q=Quantum", token1);
    assert.equal(searchTitleRes.status, 200);
    const searchTitleBody = searchTitleRes.body as { items: { id: number }[]; total: number };
    assert.equal(searchTitleBody.total >= 1, true);
    assert.ok(searchTitleBody.items.some((i) => i.id === searchableItemId));

    // Search by full content keyword
    const searchContentRes = await call("/search?q=superconductivity", token1);
    assert.equal(searchContentRes.status, 200);
    const searchContentBody = searchContentRes.body as { items: { id: number }[]; total: number };
    assert.equal(searchContentBody.total >= 1, true);
    assert.ok(searchContentBody.items.some((i) => i.id === searchableItemId));

    // Search by note content
    // Note content is "Recreated note"
    const searchNoteRes = await call("/search?q=Recreated", token1);
    assert.equal(searchNoteRes.status, 200);
    const searchNoteBody = searchNoteRes.body as { items: { id: number }[]; total: number };
    assert.equal(searchNoteBody.total >= 1, true);
    assert.ok(searchNoteBody.items.some((i) => i.id === itemId));

    // User 2 cannot find User 1's note
    const user2NoteSearch = await call("/search?q=Recreated", token2);
    assert.equal(user2NoteSearch.status, 200);
    assert.equal((user2NoteSearch.body as { total: number }).total, 0);

    // Non-existent search query returns 0 items
    const searchNoneRes = await call("/search?q=nonexistentxyz123", token1);
    assert.equal(searchNoneRes.status, 200);
    assert.equal((searchNoneRes.body as { total: number }).total, 0);
  } finally {
    server.close();
  }
});
