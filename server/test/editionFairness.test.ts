import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_PATH = ":memory:";
process.env.SESSION_SECRET = "edition-fairness-test-secret-at-least-32-characters";
const { fairShortlist, takeFairly } = await import("../src/native/editions.js");
type Candidate = Parameters<typeof takeFairly>[0][number];

let nextId = 1;
/** `count` articles of one source, the first being the freshest. */
function source(subscriptionId: number, count: number, freshest = 1): Candidate[] {
  return Array.from({ length: count }, (_, index) => ({
    id: nextId++, subscriptionId, folderId: null, sourceName: `Source ${subscriptionId}`, folderName: null,
    title: `Article ${subscriptionId}-${index}`, url: null, publishedAt: new Date(Date.UTC(2026, 9, 13, 12) - (freshest + index) * 3_600_000).toISOString(),
    snippet: null, imageUrl: null, readingMinutes: 3, previouslySelected: false,
    score: Math.pow(0.5, (freshest + index) / 18),
  }));
}
const bySource = (items: Candidate[]) => {
  const counts = new Map<number, number>();
  for (const item of items) counts.set(item.subscriptionId, (counts.get(item.subscriptionId) ?? 0) + 1);
  return counts;
};
/** The shortlist as the core builds it: an empty head, every candidate in fair order. */
function shortlist(candidates: Candidate[], limit: number, recentUse = new Map<number, number>()) {
  return fairShortlist([], takeFairly(candidates, [], recentUse), limit, new Set(candidates.map((item) => item.subscriptionId)).size);
}

test("one source may fill the whole shortlist", () => {
  const result = shortlist(source(1, 100), 80);
  assert.equal(result.length, 80);
  assert.equal(new Set(result.map((item) => item.subscriptionId)).size, 1);
});

test("a busy source cannot crowd out quiet ones, and a quiet one loses nothing", () => {
  const candidates = [...source(1, 60), ...source(2, 3, 20), ...source(3, 2, 40), ...source(4, 4, 10), ...source(5, 1, 80)];
  const counts = bySource(shortlist(candidates, 80));
  assert.equal(counts.get(2), 3);
  assert.equal(counts.get(3), 2);
  assert.equal(counts.get(4), 4);
  assert.equal(counts.get(5), 1);
  // 5 sources and 80 places: a fair share is 16, not 60.
  assert.equal(counts.get(1), 16);
});

test("many sources with one article each all appear", () => {
  const candidates = Array.from({ length: 50 }, (_, index) => source(index + 1, 1)).flat();
  const result = shortlist(candidates, 80);
  assert.equal(result.length, 50);
  assert.equal(new Set(result.map((item) => item.subscriptionId)).size, 50);
});

test("the shortlist is topped up rather than left too small to choose from", () => {
  // Two sources, one with almost nothing: the busy one may exceed its share so that 24 candidates remain.
  const result = shortlist([...source(1, 100), ...source(2, 1)], 24);
  assert.equal(result.length, 24);
  assert.equal(bySource(result).get(2), 1);
});

test("a shortlist is never empty when there are candidates, and never larger than asked for", () => {
  for (const [sources, perSource, limit] of [[1, 1, 80], [3, 200, 10], [12, 7, 80], [40, 2, 24], [2, 5, 80]] as const) {
    const candidates = Array.from({ length: sources }, (_, index) => source(index + 1, perSource)).flat();
    const result = shortlist(candidates, limit);
    assert.ok(result.length > 0 && result.length <= limit, `${sources} sources x ${perSource}, limit ${limit}`);
    assert.equal(new Set(result.map((item) => item.id)).size, result.length, "no article twice");
  }
});

test("within a source the freshest comes first, and articles offered before come after new ones", () => {
  const fresh = source(1, 3);
  fresh[2].previouslySelected = false;
  const old = source(1, 1, 0.5)[0];
  old.previouslySelected = true;
  const order = takeFairly([...fresh, old], [], new Map()).map((item) => item.id);
  assert.deepEqual(order, [fresh[0].id, fresh[1].id, fresh[2].id, old.id]);
});

test("a source shown often lately waits behind the others within a round", () => {
  const candidates = [...source(1, 2, 1), ...source(2, 2, 2), ...source(3, 2, 3)];
  const first = takeFairly(candidates, [], new Map([[1, 5], [2, 0], [3, 1]])).slice(0, 3).map((item) => item.subscriptionId);
  assert.deepEqual(first, [2, 3, 1]);
});
