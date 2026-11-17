import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_PATH = ":memory:";
process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

test("a subscriber's poll interval never slows the feed down for others", async () => {
  const { db, runMigrations } = await import("../src/db/index.js");
  const { config } = await import("../src/config.js");
  const { defaultPollIntervalMinutes, findFeedById, findSubscriptionForUser, listSubscriptionsForUser, subscribe, unsubscribe } = await import("../src/feeds/repository.js");
  const { updateFeedSettings } = await import("../src/feeds/service.js");
  runMigrations();

  const addUser = db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES (?, 'hash', ?)");
  const alice = Number(addUser.run("alice@example.test", "Alice").lastInsertRowid);
  const bob = Number(addUser.run("bob@example.test", "Bob").lastInsertRowid);
  const feedId = Number(db.prepare("INSERT INTO feeds (url, poll_interval_minutes) VALUES (?, ?)").run("https://example.com/news.xml", defaultPollIntervalMinutes()).lastInsertRowid);
  subscribe(alice, feedId);
  subscribe(bob, feedId);
  const feedInterval = () => findFeedById(feedId)!.poll_interval_minutes;

  // Alice asks for a weekly poll: her subscription says so, the feed keeps serving Bob at the default.
  updateFeedSettings(alice, feedId, { pollIntervalMinutes: 10_080 });
  assert.equal(feedInterval(), defaultPollIntervalMinutes());
  assert.equal(findSubscriptionForUser(alice, feedId)?.poll_interval_minutes, 10_080);
  assert.equal(listSubscriptionsForUser(alice)[0].poll_interval_minutes, 10_080);
  assert.equal(findSubscriptionForUser(bob, feedId)?.poll_interval_minutes, defaultPollIntervalMinutes());

  // The shortest choice wins, never below the server minimum.
  updateFeedSettings(bob, feedId, { pollIntervalMinutes: 60 });
  assert.equal(feedInterval(), 60);
  updateFeedSettings(alice, feedId, { pollIntervalMinutes: 1 });
  assert.equal(feedInterval(), config.minPollIntervalMinutes);
  assert.equal(findSubscriptionForUser(alice, feedId)?.poll_interval_minutes, config.minPollIntervalMinutes);

  // When the fastest subscriber leaves, the feed follows the ones who remain.
  unsubscribe(alice, feedId);
  assert.equal(feedInterval(), 60);

  // A new subscriber without a choice of their own gets the default and brings the feed back to it.
  subscribe(alice, feedId);
  assert.equal(feedInterval(), defaultPollIntervalMinutes());
});
