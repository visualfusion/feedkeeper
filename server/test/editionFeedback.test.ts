import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

process.env.DATABASE_PATH = ":memory:";
process.env.SESSION_SECRET = "edition-feedback-test-secret-at-least-32-characters";

test("edition feedback stores votes, adjusts candidate scores with decay, exposes MCP signals, and supports HTTP CRUD", async () => {
  const { db, runMigrations } = await import("../src/db/index.js");
  const repo = await import("../src/feeds/repository.js");
  const editions = await import("../src/native/editions.js");
  const feedback = await import("../src/native/editionFeedback.js");
  const { NativeError } = await import("../src/native/requests.js");
  const { v1Router } = await import("../src/api/v1/index.js");
  const { createPersonalAccessToken } = await import("../src/auth/tokens.js");
  const { createMcpServerForUser } = await import("../src/mcp/server.js");
  runMigrations();

  let seq = 0;
  const now = new Date("2026-11-19T10:00:00.000Z");
  const makeUser = () => Number(
    db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, 'hash', 'Reader')").run(`user-${++seq}@test.local`).lastInsertRowid,
  );
  const makeFeed = (userId: number, title: string) => {
    const id = Number(db.prepare("INSERT INTO feeds (url, title) VALUES (?, ?)").run(`https://test.local/feed/${++seq}`, title).lastInsertRowid);
    repo.subscribe(userId, id, null, null);
    return id;
  };
  const makeArticle = (feedId: number, title: string, ageHours = 1) => {
    const id = ++seq;
    const published = new Date(now.getTime() - ageHours * 3_600_000).toISOString();
    return Number(
      db.prepare(`INSERT INTO items (feed_id, guid, title, link, content_snippet, content_html, published_at, created_at)
        VALUES (?, ?, ?, ?, 'Body snippet with enough words', '<p>Full body text with enough words for an edition.</p>', ?, ?)`)
        .run(feedId, `guid-${id}`, title, `https://test.local/articles/${id}`, published, published).lastInsertRowid,
    );
  };

  const owner = makeUser();
  const stranger = makeUser();
  const techFeed = makeFeed(owner, "Tech Daily");
  const sportsFeed = makeFeed(owner, "Sports Wire");
  const strangerFeed = makeFeed(stranger, "Stranger Feed");

  const upItem = makeArticle(techFeed, "Quantum computing breakthrough at research lab", 2);
  const downItem = makeArticle(sportsFeed, "Soccer transfer rumors intensify before winter", 2);
  const strangerItem = makeArticle(strangerFeed, "Private stranger article", 1);

  assert.throws(
    () => feedback.setEditionFeedback(owner, strangerItem, 1, now),
    (err: unknown) => err instanceof NativeError && err.code === "item_not_found",
  );

  const resUp = feedback.setEditionFeedback(owner, upItem, 1, now);
  assert.deepEqual(resUp, { itemId: upItem, vote: 1, totalCount: 1 });
  const resDown = feedback.setEditionFeedback(owner, downItem, -1, now);
  assert.deepEqual(resDown, { itemId: downItem, vote: -1, totalCount: 2 });

  const state = feedback.getEditionFeedback(owner);
  assert.equal(state.totalCount, 2);
  assert.equal(state.votes[String(upItem)], 1);
  assert.equal(state.votes[String(downItem)], -1);

  // Removing the underlying item still preserves the taste signal in edition_feedback.
  db.prepare("DELETE FROM items WHERE id = ?").run(upItem);
  const scorer = feedback.createEditionFeedbackScorer(owner, now);
  const boosted = scorer(techFeed, "New quantum computing chip milestone");
  const damped = scorer(sportsFeed, "Soccer transfer deadline moves");
  assert.ok(boosted > 1.1 && boosted <= 1.85, `expected boosted multiplier, got ${boosted}`);
  assert.ok(damped < 0.9 && damped >= 0.45, `expected damped multiplier, got ${damped}`);

  // Fresh candidate scoring reflects feedback in editionCandidates.
  const freshTech = makeArticle(techFeed, "Quantum research advances again", 1);
  const freshSports = makeArticle(sportsFeed, "Winter soccer transfer update", 1);
  const candidates = editions.editionCandidates(owner, now, 200);
  const techCand = candidates.find((c) => c.id === freshTech);
  const sportsCand = candidates.find((c) => c.id === freshSports);
  assert.ok(techCand && sportsCand && techCand.score > sportsCand.score);

  // Decay weakens old feedback after 60 days (2 half-lives -> 0.25 weight).
  const future = new Date(now.getTime() + 90 * 86_400_000);
  const decayedBoost = feedback.createEditionFeedbackScorer(owner, future)(techFeed, "Quantum research");
  assert.ok(decayedBoost < boosted, "decay reduces weight over time");

  // Profile summary exposes liked/disliked sources and topics.
  const profile = feedback.getFeedbackProfile(owner, now);
  assert.equal(profile.totalVotes, 2);
  assert.deepEqual(profile.likedSources, ["Tech Daily"]);
  assert.deepEqual(profile.dislikedSources, ["Sports Wire"]);
  assert.ok(profile.likedTopics.includes("quantum"));
  assert.ok(profile.dislikedTopics.includes("soccer"));

  // MCP get_edition_candidates includes readerPreferences.
  const mcpServer = createMcpServerForUser(owner, "read");
  const client = new Client({ name: "feedback-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([mcpServer.connect(serverTransport), client.connect(clientTransport)]);
  const toolResult = await client.callTool({ name: "get_edition_candidates", arguments: { limit: 50 } });
  const mcpPayload = JSON.parse((toolResult.content as { type: string; text: string }[])[0].text);
  assert.deepEqual(mcpPayload.readerPreferences.likedSources, ["Tech Daily"]);
  assert.deepEqual(mcpPayload.readerPreferences.dislikedSources, ["Sports Wire"]);
  await client.close();
  await mcpServer.close();

  // HTTP API endpoints and /meta feature flag.
  const app = express();
  app.use(express.json());
  app.use("/api/v1", v1Router);
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const token = createPersonalAccessToken(owner, "test-device", "write").token;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  try {
    const meta = await fetch(`http://127.0.0.1:${port}/api/v1/meta`).then((r) => r.json());
    assert.ok(meta.features.includes("edition.feedback"));

    const getRes = await fetch(`http://127.0.0.1:${port}/api/v1/edition/feedback`, { headers }).then((r) => r.json());
    assert.equal(getRes.totalCount, 2);

    const postClear = await fetch(`http://127.0.0.1:${port}/api/v1/edition/feedback`, {
      method: "POST",
      headers,
      body: JSON.stringify({ itemId: downItem, vote: 0 }),
    });
    assert.equal(postClear.status, 200);
    const clearedBody = await postClear.json();
    assert.equal(clearedBody.totalCount, 1);

    const postNew = await fetch(`http://127.0.0.1:${port}/api/v1/edition/feedback`, {
      method: "POST",
      headers,
      body: JSON.stringify({ itemId: freshTech, vote: 1 }),
    });
    assert.equal(postNew.status, 200);

    const delRes = await fetch(`http://127.0.0.1:${port}/api/v1/edition/feedback`, {
      method: "DELETE",
      headers,
    });
    assert.equal(delRes.status, 204);
    assert.equal(feedback.getEditionFeedback(owner).totalCount, 0);
  } finally {
    server.close();
  }
});
