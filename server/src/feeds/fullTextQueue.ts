import { isCachedConsentSnippet } from "./extractor.js";
import { refreshLead } from "./lead.js";
import { db } from "../db/index.js";
import { hasUserCapability } from "../auth/capabilities.js";
import { loadFullText, executeFullText, type FullTextResult } from "./fullText.js";
import { articleWorkPool, restartArticleWorkPool } from "./articleWorkPool.js";
import { sourceHost } from "./requestGate.js";
import { canAccessItem, findSubscriptionFullTextMode, findItemById } from "./repository.js";

/** Refillable durable queue, bounded independently of library size. */
export function scheduleFullTexts(): number {
  const queued = db.prepare("SELECT COUNT(*) n FROM full_text_jobs").get() as { n: number };
  const room = Math.max(0, 200 - queued.n);
  if (!room) return 0;
  const eligible = (db.prepare("SELECT id FROM users").all() as { id: number }[]).filter(user => hasUserCapability(user.id, "fulltext")).map(user => user.id);
  if (!eligible.length) return 0;
  const candidates = db.prepare<[string, string, string, string, number], { id: number; user_id: number; priority: number }>(`
    WITH candidate_articles AS (
      SELECT ids.value AS item_id, e.user_id, 3 AS priority, i.created_at
      FROM editions e, json_each(e.item_ids) ids
      JOIN items i ON i.id = ids.value
      WHERE e.user_id IN (SELECT value FROM json_each(?))
        AND NOT EXISTS (SELECT 1 FROM subscriptions disabled WHERE disabled.user_id=e.user_id AND disabled.feed_id=i.feed_id AND disabled.full_text_mode='never')
        AND e.status = 'active' AND e.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
        AND i.link IS NOT NULL AND i.full_content_html IS NULL
        AND i.extraction_status != 'feed_only'
        AND (i.extraction_retry_at IS NULL OR i.extraction_retry_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        AND NOT EXISTS (SELECT 1 FROM full_text_jobs j WHERE j.item_id = i.id)

      UNION ALL

      SELECT b.item_id, b.user_id, 2 AS priority, i.created_at
      FROM item_bookmarks b
      JOIN items i ON i.id = b.item_id
      WHERE b.user_id IN (SELECT value FROM json_each(?))
        AND NOT EXISTS (SELECT 1 FROM subscriptions disabled WHERE disabled.user_id=b.user_id AND disabled.feed_id=i.feed_id AND disabled.full_text_mode='never')
        AND i.link IS NOT NULL AND i.full_content_html IS NULL
        AND i.extraction_status != 'feed_only'
        AND (i.extraction_retry_at IS NULL OR i.extraction_retry_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        AND NOT EXISTS (SELECT 1 FROM full_text_jobs j WHERE j.item_id = i.id)

      UNION ALL

      SELECT n.item_id, n.user_id, 2 AS priority, i.created_at
      FROM item_notes n
      JOIN items i ON i.id = n.item_id
      WHERE n.user_id IN (SELECT value FROM json_each(?))
        AND NOT EXISTS (SELECT 1 FROM subscriptions disabled WHERE disabled.user_id=n.user_id AND disabled.feed_id=i.feed_id AND disabled.full_text_mode='never')
        AND i.link IS NOT NULL AND i.full_content_html IS NULL
        AND i.extraction_status != 'feed_only'
        AND (i.extraction_retry_at IS NULL OR i.extraction_retry_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        AND NOT EXISTS (SELECT 1 FROM full_text_jobs j WHERE j.item_id = i.id)

      UNION ALL

      SELECT i.id AS item_id, s.user_id, 1 AS priority, i.created_at
      FROM subscriptions s
      JOIN items i ON i.feed_id = s.feed_id
      WHERE s.user_id IN (SELECT value FROM json_each(?))
        AND COALESCE(s.full_text_mode, 'auto') = 'auto'
        AND i.link IS NOT NULL AND i.full_content_html IS NULL
        AND i.extraction_status != 'feed_only'
        AND (i.extraction_retry_at IS NULL OR i.extraction_retry_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        AND NOT EXISTS (SELECT 1 FROM full_text_jobs j WHERE j.item_id = i.id)
    )
    SELECT item_id AS id, user_id, MAX(priority) AS priority
    FROM candidate_articles
    GROUP BY item_id
    ORDER BY (priority + CAST((julianday('now')-julianday(created_at))*1440 / 60 AS INTEGER)) DESC, created_at ASC LIMIT ?`).all(JSON.stringify(eligible), JSON.stringify(eligible), JSON.stringify(eligible), JSON.stringify(eligible), room);
  const add = db.prepare("INSERT OR IGNORE INTO full_text_jobs(item_id, user_id, priority, created_at) VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))");
  let count = 0;
  db.transaction(() => {
    for (const row of candidates) if (hasUserCapability(row.user_id, "fulltext")) count += add.run(row.id, row.user_id, row.priority).changes;
  })();
  return count;
}

/** Explicit priority requests never run publisher I/O inside an HTTP batch request. */
export function enqueueArticleContents(userId: number, ids: number[]): number[] {
  if (ids.length > 50 || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error("invalid_source_selection");
  if (!hasUserCapability(userId, "fulltext")) throw new Error("capability_not_available");
  const unique = [...new Set(ids)];
  if (unique.some(id => !canAccessItem(userId, id))) throw new Error("item_not_found");
  return db.transaction(() => {
    const add = db.prepare("INSERT INTO full_text_jobs(item_id,user_id,priority,created_at) VALUES (?,?,4,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(item_id) DO UPDATE SET priority = MAX(priority,4), user_id = excluded.user_id");
    const queued: number[] = [];
    for (const id of unique) {
      const item = findItemById(id)!;
      if (item.full_content_html || item.extraction_status === "feed_only" || findSubscriptionFullTextMode(userId, item.feed_id) === "never") continue;
      if (item.extraction_retry_at && Date.parse(item.extraction_retry_at) > Date.now()) continue;
      ensureRoom(id);
      add.run(id, userId); queued.push(id);
    }
    wake();
    return queued;
  })();
}

/** Synchronous consumers join durable article jobs and wait for their results. */
export async function prepareArticleContents(userId: number, ids: number[]) {
  if (ids.length > 50 || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error("invalid_source_selection");
  const unique = [...new Set(ids)];
  if (unique.some(id => !canAccessItem(userId, id))) throw new Error("item_not_found");
  if (!hasUserCapability(userId, "fulltext")) throw new Error("capability_not_available");
  const results: { id: number; ok: boolean; error?: string }[] = [];
  // Avoid queueing an unbounded number of suspended host slots.
  for (let start = 0; start < unique.length; start += 2) {
    results.push(...await Promise.all(unique.slice(start, start + 2).map(async id => {
      if (!hasUserCapability(userId, "fulltext")) throw new Error("capability_not_available");
      const result = await loadFullText(userId, id);
      return { id, ok: result.ok, ...(!result.ok ? { error: result.error } : {}) };
    })));
  }
  return results;
}
type Job = { item_id: number; user_id: number; priority: number; attempts: number; force: number; created_at: string; link: string | null };
type Listener = { user: number; resolve: (result: FullTextResult) => void; timer: NodeJS.Timeout };
const active = new Map<number, Promise<void>>();
const listeners = new Map<number, Set<Listener>>();
let listenerCount = 0;
let timer: NodeJS.Timeout | undefined;
let seedTimer: NodeJS.Timeout | undefined;
let stopping = false;
let scheduled = false;
const startedAt = Date.now();
let completed = 0;
let failed = 0;
let consumerTimeouts = 0;
let attemptErrors = 0;
const errorCounts: Partial<Record<import("./fullText.js").FullTextError, number>> = {};
let retries = 0;
let throttled = 0;
let rejected = 0;

function ensureRoom(id: number) {
  if (!db.prepare("SELECT 1 FROM full_text_jobs WHERE item_id = ?").get(id) &&
      (db.prepare("SELECT COUNT(*) n FROM full_text_jobs").get() as { n: number }).n >= 1000) throw new Error("queue_full");
}

/** Waiting HTTP consumers are bounded separately from the durable queue. Their deadline never deletes work. */
export function requestFullText(user: number, id: number, force: boolean): Promise<FullTextResult> {
  if (stopping || listenerCount >= 64) { rejected++; return Promise.resolve({ ok: false, error: "queue_full" }); }
  try {
    ensureRoom(id);
    db.prepare(`INSERT INTO full_text_jobs(item_id,user_id,priority,force,created_at) VALUES (?,?,5,?,?)
      ON CONFLICT(item_id) DO UPDATE SET user_id=excluded.user_id, priority=MAX(priority,5), force=MAX(force,excluded.force)`)
      .run(id, user, Number(force), new Date().toISOString());
  } catch (error) {
    rejected++;
    if (error instanceof Error && error.message === "queue_full") return Promise.resolve({ ok: false, error: "queue_full" });
    console.error(JSON.stringify({ event: "fulltext_queue_error" }));
    return Promise.resolve({ ok: false, error: "extraction_failed" });
  }
  return new Promise(resolve => {
    const entry: Listener = { user, resolve, timer: setTimeout(() => {
      listeners.get(id)?.delete(entry); listenerCount--; consumerTimeouts++;
      if (!listeners.get(id)?.size) listeners.delete(id);
      resolve({ ok: false, error: "timeout" });
    }, 30_000) };
    const pending = listeners.get(id) ?? new Set<Listener>();
    pending.add(entry); listeners.set(id, pending); listenerCount++;
    wake();
  });
}

export function authorizedFullTextRequester(id: number, preferred: number): number | undefined {
  const owner = db.prepare<[number], { user_id: number }>("SELECT user_id FROM full_text_jobs WHERE item_id=?").get(id)?.user_id;
  const candidates = new Set([owner, preferred, ...[...(listeners.get(id) ?? [])].map(entry => entry.user)]);
  return [...candidates].find(user => user !== undefined && canAccessItem(user, id) && hasUserCapability(user, "fulltext") && findSubscriptionFullTextMode(user, findItemById(id)!.feed_id) !== "never");
}
function finishListeners(id: number, result: FullTextResult) {
  const pending = listeners.get(id);
  listeners.delete(id);
  for (const entry of pending ?? []) {
    clearTimeout(entry.timer); listenerCount--;
    const allowed = canAccessItem(entry.user, id) && hasUserCapability(entry.user, "fulltext");
    entry.resolve(allowed ? result : { ok: false, error: "capability_not_available" });
  }
}
function wake() {
  if (stopping || scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    try { pump(); } catch {
      console.error(JSON.stringify({ event: "fulltext_queue_error" }));
      if (!stopping) { timer = setTimeout(wake, 1000); timer.unref(); }
    }
  });
}
export function configureFullTextPool() {
  const pool = articleWorkPool();
  pool.cooldown = host => Date.parse(db.prepare<[string], { retry_at: string }>("SELECT retry_at FROM full_text_hosts WHERE host=?").get(host)?.retry_at ?? "") || 0;
  return pool;
}
export function deferFullTextHost(host: string, retryAt?: number) {
  const previous = db.prepare<[string], { retry_at: string }>("SELECT retry_at FROM full_text_hosts WHERE host=?").get(host);
  const until = Math.max(Date.now() + 1000, retryAt ?? 0, Date.parse(previous?.retry_at ?? "") || 0);
  db.prepare("INSERT INTO full_text_hosts(host,retry_at) VALUES (?,?) ON CONFLICT(host) DO UPDATE SET retry_at=excluded.retry_at")
    .run(host, new Date(until).toISOString());
}
function pump() {
  if (stopping) return;
  if (timer) clearTimeout(timer);
  const pool = configureFullTextPool();
  if (active.size >= pool.limits.concurrency) return;
  if (seedTimer && (db.prepare("SELECT COUNT(*) n FROM full_text_jobs").get() as { n: number }).n < pool.limits.concurrency * 2) scheduleFullTexts();
  const jobs = db.prepare<[string, number], Job>(`SELECT j.*, i.link FROM full_text_jobs j JOIN items i ON i.id=j.item_id
    WHERE julianday(j.available_at) <= julianday(?) ORDER BY (j.priority + CAST((julianday('now')-julianday(j.created_at))*86400000 / ? AS INTEGER)) DESC,
    j.created_at, j.item_id LIMIT 1000`).all(new Date().toISOString(), pool.limits.agingMs);
  for (const job of jobs) {
    if (active.size >= pool.limits.concurrency) break;
    if (active.has(job.item_id)) continue;
    let host: string;
    try { host = sourceHost(job.link ?? ""); } catch {
      db.prepare("DELETE FROM full_text_jobs WHERE item_id=?").run(job.item_id);
      finishListeners(job.item_id, { ok: false, error: "item_has_no_link" }); continue;
    }
    const cooldown = db.prepare<[string], { retry_at: string }>("SELECT retry_at FROM full_text_hosts WHERE host=?").get(host);
    if (cooldown && Date.parse(cooldown.retry_at) > Date.now()) {
      db.prepare("UPDATE full_text_jobs SET available_at=? WHERE item_id=?").run(cooldown.retry_at, job.item_id); continue;
    }
    if (!pool.canStart(host)) continue;
    const work = execute(job, host).finally(() => { active.delete(job.item_id); wake(); });
    active.set(job.item_id, work);
  }
  const nextJob = db.prepare<[], { next_at: string | null }>("SELECT MIN(available_at) AS next_at FROM full_text_jobs").get();
  if (nextJob?.next_at) {
    const delay = Math.max(250, Math.min(30_000, Date.parse(nextJob.next_at) - Date.now()));
    timer = setTimeout(wake, delay);
    timer.unref();
  }
}
async function execute(job: Job, host: string) {
  try {
    const result = await executeFullText(job.user_id, job.item_id, !!job.force, job.priority);
    if (stopping) return; // The SQLite row is the restart record, including its original age.
    if (!result.ok) { attemptErrors++; errorCounts[result.error] = (errorCounts[result.error] ?? 0) + 1; }
    if (!result.ok && result.error === "source_busy" && !result.deferred) {
      throttled++;
      deferFullTextHost(result.host ?? host, result.retryAt);
    }
    if (!result.ok && result.retryable && (result.deferred || job.attempts < 2)) {
      const delay = Math.min(60_000, 1000 * 2 ** job.attempts) * (0.5 + Math.random() * 0.5);
      const retryAt = Math.max(Date.now() + delay, result.retryAt ?? 0);
      db.transaction(() => {
        db.prepare("UPDATE full_text_jobs SET attempts=attempts+?,available_at=? WHERE item_id=?").run(result.deferred ? 0 : 1, new Date(retryAt).toISOString(), job.item_id);
        db.prepare("UPDATE items SET extraction_status='pending',extraction_retry_at=NULL WHERE id=?").run(job.item_id);

      })();
      retries++; return;
    }
    if (!result.ok && result.retryable) {
      const retryAt = Math.max(Date.now() + 3600_000, result.retryAt ?? 0);
      db.prepare("UPDATE items SET extraction_status=?,extraction_retry_at=? WHERE id=?")
        .run(result.error === "source_busy" ? "bot_blocked" : "failed", new Date(retryAt).toISOString(), job.item_id);
    }
    db.prepare("DELETE FROM full_text_jobs WHERE item_id=?").run(job.item_id);
    completed++; if (!result.ok) failed++; finishListeners(job.item_id, result);
  } catch {
    // A database failure retains the restart record and fails the current waiters explicitly.
    finishListeners(job.item_id, { ok: false, error: "extraction_failed" });
    console.error(JSON.stringify({ event: "fulltext_queue_error" }));
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
export function fullTextMetrics() {
  const queued = (db.prepare("SELECT COUNT(*) n FROM full_text_jobs").get() as { n: number }).n;
  const oldest = (db.prepare("SELECT MIN(created_at) oldest FROM full_text_jobs").get() as { oldest: string | null }).oldest;
  const work = articleWorkPool().metrics();
  return { queued, waiters: listenerCount, ...work, completed, failed, attemptErrors, errorCounts: {...errorCounts}, consumerTimeouts, retries, throttled, rejected,
    meanDurationMs: work.completed ? work.durationMs / work.completed : 0,
    throughputPerSecond: completed / Math.max(1, (Date.now() - startedAt) / 1000),
    oldestWaitMs: oldest ? Math.max(0, Date.now() - Date.parse(oldest)) : 0 };
}
export async function runFullTextQueue(): Promise<void> {
  if (stopping) return;
  if ((db.prepare("SELECT COUNT(*) n FROM full_text_jobs").get() as { n: number }).n < 200) scheduleFullTexts();
  pump();
  await Promise.all(active.values());
}
export function startFullTextScheduler(): NodeJS.Timeout {
  if (seedTimer) return seedTimer;
  stopping = false;
  restartArticleWorkPool();
  // Older versions can insert rows without the added age column after a rollback.
  db.prepare("UPDATE full_text_jobs SET created_at=available_at WHERE created_at=''").run();
  const tick = () => {
    db.prepare("DELETE FROM full_text_hosts WHERE julianday(retry_at) <= julianday(?)").run(new Date().toISOString());
    scheduleFullTexts(); wake();
    console.log(JSON.stringify({ event: "fulltext_queue", ...fullTextMetrics() }));
  };
  // Repair old consent-only caches once; the normal bounded planner performs network work.
  const cached = db.prepare<[], { id: number; full_content_html: string }>("SELECT id,full_content_html FROM items WHERE full_content_html IS NOT NULL AND (lower(full_content_html) LIKE '%cookie%' OR lower(full_content_html) LIKE '%consent%') LIMIT 100").all();
  db.transaction(() => {
    for (const item of cached) if (isCachedConsentSnippet(item.full_content_html)) {
      db.prepare("UPDATE items SET full_content_html=NULL,extraction_status='pending',extraction_retry_at=NULL WHERE id=?").run(item.id);
      refreshLead(item.id);
    }
  })();
  tick(); seedTimer = setInterval(tick, 15_000); seedTimer.unref(); return seedTimer;
}
export async function stopFullTextScheduler() {
  stopping = true;
  if (timer) clearTimeout(timer);
  if (seedTimer) clearInterval(seedTimer);
  seedTimer = undefined;
  for (const id of listeners.keys()) finishListeners(id, { ok: false, error: "queue_full" });
  await articleWorkPool().close();
  await Promise.all(active.values());
}
