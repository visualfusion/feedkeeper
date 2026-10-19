import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_PATH = ":memory:";
process.env.SESSION_SECRET = "lead-tests-only-at-least-32-characters-long";

const SENTENCE = "The ministry confirmed on Tuesday that the new rules apply from November, after months of talks with the associations. ";
const html = (extra = "") => '<ol><li><a href="/">Home</a></li><li><a href="/news">News</a></li></ol><p>© dpa | 14.10.2026 06:43</p>' +
  `<p>${SENTENCE.repeat(3)}</p><p>Operators have until the end of the year to adapt their systems.</p>${extra}`;

test("the lead is derived when content is stored, kept while it is unchanged and refreshed when it changes", async () => {
  const { db, runMigrations } = await import("../src/db/index.js");
  const repo = await import("../src/feeds/repository.js");
  const { backfillLeads, leadOf } = await import("../src/feeds/lead.js");
  const { LEAD_VERSION } = await import("../src/feeds/contentNoise.js");
  const { serializeItem } = await import("../src/api/v1/serialize.js");
  runMigrations();
  const feed = Number(db.prepare("INSERT INTO feeds(url) VALUES ('https://lead.example.test/feed')").run().lastInsertRowid);
  const id = (guid: string) => Number((db.prepare("SELECT id FROM items WHERE guid = ?").get(guid) as { id: number }).id);

  repo.upsertItems(feed, [{ guid: "a", title: "Story", contentSnippet: "Short summary.", contentHtml: html() }]);
  const stored = repo.findItemById(id("a"))!;
  assert.equal(stored.lead_version, LEAD_VERSION);
  assert.ok(stored.content_lead!.startsWith("The ministry confirmed"), stored.content_lead!);
  assert.ok(!/dpa|Home|News/.test(stored.content_lead!));

  // Polling rewrites every item; an unchanged one is not derived again.
  db.prepare("UPDATE items SET content_lead = 'marker' WHERE id = ?").run(id("a"));
  repo.upsertItems(feed, [{ guid: "a", title: "Story", contentSnippet: "Short summary.", contentHtml: html() }]);
  assert.equal(repo.findItemById(id("a"))!.content_lead, "marker");

  // Changed feed content is derived again; the revision logic of content changes is not disturbed.
  const revision = repo.findItemById(id("a"))!.content_revision;
  repo.upsertItems(feed, [{ guid: "a", title: "Story", contentSnippet: "Short summary.", contentHtml: html("<p>One more paragraph with news.</p>") }]);
  const changed = repo.findItemById(id("a"))!;
  assert.notEqual(changed.content_lead, "marker");
  assert.ok(changed.content_revision > revision);

  // A downloaded full text takes over, and later feed changes no longer touch the lead.
  repo.updateItemFullContent(id("a"), "<p>The complete article text begins here and goes on for a while with more detail.</p>");
  assert.match(repo.findItemById(id("a"))!.content_lead!, /^The complete article text begins here/);
  db.prepare("UPDATE items SET content_lead = 'full-text-lead' WHERE id = ?").run(id("a"));
  repo.upsertItems(feed, [{ guid: "a", title: "Story", contentSnippet: "Short summary.", contentHtml: html("<p>Another feed edit.</p>") }]);
  assert.equal(repo.findItemById(id("a"))!.content_lead, "full-text-lead");

  // Items from before the column existed are served with a derived lead and picked up by the backfill.
  db.prepare("UPDATE items SET content_lead = NULL, lead_version = NULL WHERE id = ?").run(id("a"));
  const legacy = repo.findItemById(id("a"))!;
  assert.match(leadOf(legacy)!, /^The complete article text/);
  assert.equal(serializeItem(legacy as never, new Map(), false).lead, leadOf(legacy));
  assert.equal(backfillLeads(), 1);
  assert.equal(backfillLeads(), 0);
  const { getItemForMcp } = await import("../src/mcp/items.js");
  const owner = Number(db.prepare("INSERT INTO users(email,password_hash,display_name) VALUES ('lead@example.test','hash','Lead')").run().lastInsertRowid);
  db.prepare("INSERT INTO subscriptions(user_id,feed_id) VALUES (?,?)").run(owner, feed);
  const mcp = getItemForMcp(owner, id("a"))!;
  assert.ok(!("content_lead" in mcp) && !("lead_version" in mcp), "internal lead columns are not part of the MCP item");
  assert.equal(repo.findItemById(id("a"))!.lead_version, LEAD_VERSION);
});

test("a long lead ends at a sentence, a short article keeps all of its text and a failed download falls back to the summary", async () => {
  const { leadText } = await import("../src/feeds/contentNoise.js");
  const long = leadText({ html: `<p>${SENTENCE.repeat(12)}</p>` });
  assert.ok(long.length <= 600 && long.length > 300, String(long.length));
  assert.ok(long.endsWith("associations."), long.slice(-30));
  assert.equal(leadText({ html: "<p>Only a short sentence here.</p>" }), "Only a short sentence here.");
  assert.equal(leadText({ html: "", snippet: "The feed only delivers this summary.\nThe post X appeared first on Y.", title: "X" }), "The feed only delivers this summary.");
  assert.equal(leadText({ html: null, snippet: null }), "");
});

test("a feed that alternates between a full and a shortened variant does not change the content on every poll", async () => {
  const { db, runMigrations } = await import("../src/db/index.js");
  const repo = await import("../src/feeds/repository.js");
  runMigrations();
  const feed = Number(db.prepare("INSERT INTO feeds(url) VALUES ('https://variant.example.test/feed')").run().lastInsertRowid);
  const full = { guid: "v", title: "Variant", contentSnippet: "von Author I 12.10.2026 Full summary of the story.", contentHtml: `<p>von Author</p><p>${SENTENCE.repeat(4)}</p>` };
  const short = { guid: "v", title: "Variant", contentSnippet: "Full summary of the story.", contentHtml: `<p>${SENTENCE.repeat(2)}</p>` };
  repo.upsertItems(feed, [full]);
  const id = Number((db.prepare("SELECT id FROM items WHERE guid = 'v'").get() as { id: number }).id);
  const revision = repo.findItemById(id)!.content_revision;
  for (const variant of [short, full, short, full, short]) repo.upsertItems(feed, [variant]);
  const item = repo.findItemById(id)!;
  assert.equal(item.content_revision, revision, "the shortened variants must not bump the revision");
  assert.equal(item.content_snippet, full.contentSnippet);
});
