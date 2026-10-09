import { AsyncResource } from "node:async_hooks";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { db } from "../db/index.js";
import { findFeedById, updateFeedAfterPoll, type Feed } from "./repository.js";
import { FeedHttpError } from "./fetcher.js";
import { feedRequests, PollDeferredError, PollShutdownError, RequestQueueFullError, sourceHost } from "./requestGate.js";
import { readPollSettings, type PollSettings } from "./pollSettings.js";
import { pushOutboxMetrics } from "../pushOutbox.js";

// Created when the core is loaded at startup, outside HTTP middleware. Background attempts
// must not inherit a request's cached capabilities (or keep that request context alive).
const pollingContext = new AsyncResource("FeedKeeperPolling");

export interface PollResult { newItems: number; error: string | null; deferred?: boolean; retryAt?: number }
interface Job { feed_id: number; host: string; enqueued_at: number; available_at: number; attempts: number }
type Attempt = (feed: Feed, signal: AbortSignal) => Promise<PollResult>;
type Waiter = { promise: Promise<PollResult>; resolve: (result: PollResult) => void; timer: NodeJS.Timeout };

export function retryDelay(attempt: number, settings: PollSettings, random = Math.random()): number {
  return Math.ceil(Math.min(settings.retryMaxMs, settings.retryBaseMs * 2 ** attempt) * (0.5 + random * 0.5));
}
function isTransient(error: unknown): boolean {
  return error instanceof FeedHttpError ? [408, 425, 429, 500, 502, 503, 504].includes(error.status)
    : error instanceof TypeError || error instanceof RequestQueueFullError || (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name));
}
export function pollErrorCode(error: unknown): string {
  if (error instanceof FeedHttpError) return `feed_http_${error.status}`;
  if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) return "feed_timeout";
  if (error instanceof TypeError) return "feed_network_error";
  return "feed_invalid_or_unavailable";
}

/** Install storage callbacks before discovery can run, without querying before migrations. */
export function configurePollHostCooldowns(): void {
  feedRequests.cooldown = host => (db.prepare<[string], { retry_at: number }>("SELECT retry_at FROM feed_poll_hosts WHERE host = ?").get(host)?.retry_at ?? 0);
  feedRequests.defer = (host, until) => {
    db.prepare("INSERT INTO feed_poll_hosts(host,retry_at) VALUES (?,?) ON CONFLICT(host) DO UPDATE SET retry_at = MAX(retry_at,excluded.retry_at)").run(host, until);
  };
}

/** SQLite stores pending work; only active attempts and a capped set of API waiters live in memory.
 * There is deliberately no durable running lock: restart simply replays unfinished jobs.
 * Exactly one application process may own a database (not PM2 cluster / multiple replicas).
 */
export class PollQueue {
  private active = new Map<number, { promise: Promise<PollResult>; controller: AbortController; host: string }>();
  private waiters = new Map<number, Waiter>();
  private stopped = false;
  private pumping = false;
  private repump = false;
  private seed: Promise<void> | undefined;
  private timer: NodeJS.Timeout | undefined;
  private logTimer: NodeJS.Timeout | undefined;
  private errorCounts: Record<string, number> = {};
  private counters = { succeeded: 0, newItems: 0, completed: 0, errors: 0, retries: 0, throttled: 0, coalesced: 0, deferred: 0, durationMs: 0, maxDurationMs: 0, startLagMs: 0, maxStartLagMs: 0 };
  private since = Date.now();

  constructor(private attempt: Attempt, private eligible: (feedId: number) => boolean, readonly settings = readPollSettings()) {
    configurePollHostCooldowns();
  }

  /** Preserve existing backoff; manual refresh never resets a retry budget or host cooldown. */
  enqueue(feed: Feed): void {
    if (this.active.has(feed.id) || feed.is_system_inbox || !this.eligible(feed.id)) return;
    const now = Date.now();
    db.prepare("INSERT OR IGNORE INTO feed_poll_jobs(feed_id,host,enqueued_at,available_at) VALUES (?,?,?,?)")
      .run(feed.id, sourceHost(feed.url), now, now);
  }
  submit(feed: Feed): Promise<PollResult> {
    if (this.stopped) {
      // In-flight HTTP handlers may finish subscribing during drain. Preserve their request
      // for the next process, even though this process will no longer dispatch work.
      this.enqueue(feed);
      return Promise.resolve({ newItems: 0, error: null, deferred: true });
    }
    const running = this.active.get(feed.id);
    if (running) { this.counters.coalesced++; return running.promise; }
    const waiting = this.waiters.get(feed.id);
    if (waiting) { this.counters.coalesced++; return waiting.promise; }
    this.enqueue(feed);
    const job = db.prepare<[number], Job>("SELECT * FROM feed_poll_jobs WHERE feed_id = ?").get(feed.id);
    if (!job) return Promise.resolve({ newItems: 0, error: "feed_poll_not_allowed" });
    const retryAt = Math.max(job.available_at, feedRequests.cooldown(job.host));
    if (retryAt > Date.now() || this.waiters.size >= this.settings.maxWaiters) {
      this.counters.deferred++;
      this.kick();
      return Promise.resolve({ newItems: 0, error: null, deferred: true, retryAt });
    }
    let resolve!: (result: PollResult) => void;
    const promise = new Promise<PollResult>(done => { resolve = done; });
    const timer = setTimeout(() => {
      this.waiters.delete(feed.id);
      this.counters.deferred++;
      resolve({ newItems: 0, error: null, deferred: true });
    }, this.settings.attemptTimeoutMs);
    this.waiters.set(feed.id, { promise, resolve, timer });
    this.kick();
    return promise;
  }

  /** Keyset pages create no Promise/task per feed, and yield so imports/sync remain responsive. */
  seedDue(): Promise<void> {
    if (this.seed) return this.seed;
    this.seed = (async () => {
      let after = 0;
      while (!this.stopped) {
        const rows = db.prepare<[number], Feed>(`SELECT f.* FROM feeds f
          WHERE f.id > ? AND f.is_system_inbox = 0
          AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.feed_id = f.id)
          AND NOT EXISTS (SELECT 1 FROM feed_poll_jobs j WHERE j.feed_id = f.id)
          AND (f.last_polled_at IS NULL OR f.last_polled_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now','-' || f.poll_interval_minutes || ' minutes'))
          ORDER BY f.id LIMIT 200`).all(after);
        if (!rows.length) break;
        db.transaction(() => { for (const feed of rows) if (!this.active.has(feed.id)) this.enqueue(feed); })();
        after = rows[rows.length - 1].id;
        this.kick();
        await yieldTurn();
      }
      this.kick();
    })().finally(() => { this.seed = undefined; });
    return this.seed;
  }
  start(): void {
    if (this.timer || this.stopped) return;
    pollingContext.runInAsyncScope(() => {
      this.timer = setInterval(() => this.kick(), this.settings.tickMs);
      this.timer.unref();
      this.logTimer = setInterval(() => {
        try {
          console.log(JSON.stringify({ event: "feed_poll_metrics", ...this.metrics() }));
          db.prepare("DELETE FROM feed_poll_hosts WHERE retry_at <= ?").run(Date.now());
        } catch { console.error(JSON.stringify({ event: "feed_poll_queue_error", code: "metrics_storage_failure" })); }
      }, 60_000);
      this.logTimer.unref();
    });
  }
  kick(): void {
    if (this.stopped) return;
    if (this.pumping) { this.repump = true; return; }
    this.pumping = true;
    // Schedule in a new event-loop turn, including after a synchronous DB/eligibility failure.
    pollingContext.runInAsyncScope(() => setImmediate(() => {
      this.repump = false;
      try { this.pump(); }
      catch { console.error(JSON.stringify({ event: "feed_poll_queue_error", code: "queue_storage_or_eligibility_failure" })); }
      finally { this.pumping = false; if (this.repump) this.kick(); }
    }));
  }
  private pump() {
    while (!this.stopped && this.active.size < this.settings.concurrency) {
      const blockedHosts = [...new Set([...this.active.values()].map(entry => entry.host))]
        .filter(host => [...this.active.values()].filter(entry => entry.host === host).length >= this.settings.hostConcurrency);
      const job = db.prepare<[number, string, string, number], Job>(`SELECT j.* FROM feed_poll_jobs j
        WHERE j.available_at <= ?
        AND j.feed_id NOT IN (SELECT value FROM json_each(?))
        AND j.host NOT IN (SELECT value FROM json_each(?))
        AND NOT EXISTS (SELECT 1 FROM feed_poll_hosts h WHERE h.host = j.host AND h.retry_at > ?)
        ORDER BY j.enqueued_at, j.feed_id LIMIT 1`).get(Date.now(), JSON.stringify([...this.active.keys()]), JSON.stringify(blockedHosts), Date.now());
      if (!job) break;
      const feed = findFeedById(job.feed_id);
      if (!feed || feed.is_system_inbox || !this.eligible(feed.id)) {
        db.prepare("DELETE FROM feed_poll_jobs WHERE feed_id = ?").run(job.feed_id);
        this.resolve(job.feed_id, { newItems: 0, error: "feed_poll_not_allowed" });
        continue;
      }
      // A URL may have been changed since enqueue. Do not dispatch under its old host budget.
      if (sourceHost(feed.url) !== job.host) {
        db.prepare("UPDATE feed_poll_jobs SET host = ? WHERE feed_id = ?").run(sourceHost(feed.url), feed.id);
        continue;
      }
      const waiter = this.waiters.get(feed.id);
      if (waiter) clearTimeout(waiter.timer);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new DOMException("Poll deadline exceeded", "TimeoutError")), this.settings.attemptTimeoutMs);
      const started = Date.now();
      const dueAt = feed.last_polled_at ? Date.parse(feed.last_polled_at) + feed.poll_interval_minutes * 60_000 : Date.parse(feed.created_at);
      const lag = Math.max(0, started - dueAt);
      this.counters.startLagMs += lag;
      this.counters.maxStartLagMs = Math.max(this.counters.maxStartLagMs, lag);
      const promise = this.run(job, feed, controller.signal).catch(() => {
        console.error(JSON.stringify({ event: "feed_poll_queue_error", code: "attempt_storage_failure" }));
        // A storage failure leaves the durable job intact. Stop admission until process restart.
        this.stopped = true;
        return { newItems: 0, error: "feed_poll_storage_failure", deferred: true };
      }).finally(() => {
        clearTimeout(timeout);
        const duration = Date.now() - started;
        this.counters.durationMs += duration;
        this.counters.maxDurationMs = Math.max(this.counters.maxDurationMs, duration);
        this.counters.completed++;
        this.active.delete(feed.id);
        this.kick();
      });
      this.active.set(feed.id, { promise, controller, host: job.host });
      void promise.then(result => this.resolve(feed.id, result));
    }
  }
  private async run(job: Job, feed: Feed, signal: AbortSignal): Promise<PollResult> {
    try {
      const result = await this.attempt(feed, signal);
      db.prepare("DELETE FROM feed_poll_jobs WHERE feed_id = ?").run(feed.id);
      if (!result.error) { this.counters.succeeded++; this.counters.newItems += result.newItems; }
      return result;
    } catch (error) {
      if (this.stopped || error instanceof PollShutdownError) return { newItems: 0, error: null, deferred: true };
      if (error instanceof PollDeferredError) {
        this.counters.throttled++;
        db.prepare("UPDATE feed_poll_jobs SET available_at = ? WHERE feed_id = ?").run(error.retryAt, feed.id);
        return { newItems: 0, error: null, deferred: true, retryAt: error.retryAt };
      }
      this.counters.errors++;
      if (error instanceof FeedHttpError && [429, 503].includes(error.status)) this.counters.throttled++;
      const message = pollErrorCode(error);
      this.errorCounts[message] = (this.errorCounts[message] ?? 0) + 1;
      const transient = isTransient(error);
      const retry = transient && job.attempts < this.settings.maxRetries;
      const retryAt = Math.max(Date.now() + retryDelay(job.attempts, this.settings), error instanceof FeedHttpError ? error.retryAt ?? 0 : 0);
      const resumeAt = retry ? retryAt : Math.max(retryAt, Date.now() + feed.poll_interval_minutes * 60_000);
      db.transaction(() => {
        updateFeedAfterPoll(feed.id, { error: message });
        if (retry) {
          // Rejoin the tail: a failing source cannot repeatedly displace fresh work.
          db.prepare("UPDATE feed_poll_jobs SET attempts = attempts + 1, available_at = ?, enqueued_at = ? WHERE feed_id = ?").run(retryAt, Date.now(), feed.id);
        } else {
          // Exhausted/permanent failures resume only on the next regular interval. Manual triggers
          // join this durable delay instead of starting a fresh retry budget immediately.
          db.prepare("UPDATE feed_poll_jobs SET attempts = 0, available_at = ?, enqueued_at = ? WHERE feed_id = ?")
            .run(resumeAt, Date.now(), feed.id);
        }
      })();
      if (retry) this.counters.retries++;
      return { newItems: 0, error: message, ...(transient ? { deferred: true, retryAt: resumeAt } : {}) };
    }
  }
  private resolve(id: number, result: PollResult) {
    const waiter = this.waiters.get(id);
    if (!waiter) return;
    clearTimeout(waiter.timer);
    this.waiters.delete(id);
    waiter.resolve(result);
  }
  metrics() {
    const now = Date.now();
    const queue = db.prepare<[number, number], { pending: number; due: number; oldestMs: number }>(`SELECT COUNT(*) pending,
      COALESCE(SUM(available_at <= ?),0) due, COALESCE(MAX(? - enqueued_at),0) oldestMs FROM feed_poll_jobs`).get(now, now)!;
    const { completed, ...counters } = this.counters;
    return { ...queue, errorCounts: { ...this.errorCounts }, meanDurationMs: this.counters.durationMs / Math.max(1, completed), meanStartLagMs: this.counters.startLagMs / Math.max(1, completed), running: this.active.size, waiters: this.waiters.size, requests: feedRequests.stats, push: pushOutboxMetrics(),
      completed, ...counters, elapsedMs: now - this.since,
      throughputPerSecond: completed / Math.max(1, (now - this.since) / 1000) };
  }
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.logTimer) clearInterval(this.logTimer);
    for (const id of this.waiters.keys()) this.resolve(id, { newItems: 0, error: null, deferred: true });
    for (const entry of this.active.values()) entry.controller.abort(new PollShutdownError());
    await Promise.allSettled([...this.active.values()].map(entry => entry.promise));
    await this.seed;
  }
}
