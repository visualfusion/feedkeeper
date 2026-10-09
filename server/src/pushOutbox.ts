import { AsyncResource } from "node:async_hooks";
import { db } from "./db/index.js";
import { hasUserCapability } from "./auth/capabilities.js";
import { newItemsPushPayload, sendPushTarget } from "./push.js";
import { parseRetryAfter } from "./feeds/fetcher.js";

// Initialized during startup, so background work never retains an HTTP capability cache.
const context = new AsyncResource("FeedKeeperPushOutbox");
interface Event {
  id: number; feed_id: number; max_item_id: number; item_count: number;
  subscription_ceiling: number; subscription_cursor: number; current_subscription: number;
  device_cursor: number; device_ceiling: number; target_device: number; attempts: number;
}

/** Call inside the article/job-completion transaction. No network or recipient-sized array. */
export function enqueueNewItemNotifications(feedId: number, newItems: number): void {
  if (!newItems) return;
  const ceiling = db.prepare<[number], { id: number | null }>(
    "SELECT MAX(id) id FROM subscriptions WHERE feed_id = ? AND notify = 1",
  ).get(feedId)!.id;
  if (ceiling === null) return;
  const maxItem = db.prepare<[number], { id: number }>("SELECT MAX(id) id FROM items WHERE feed_id = ?").get(feedId)!.id;
  db.prepare(`INSERT INTO push_outbox(feed_id,max_item_id,item_count,subscription_ceiling,available_at,created_at)
    VALUES (?,?,?,?,?,?)`).run(feedId, maxItem, Math.min(newItems, 10), ceiling, Date.now(), Date.now());
}

/** Exactly one worker per process. SQLite holds fanout and progress, not suspended tasks.
 * A delivery accepted immediately before a crash can repeat (at-least-once); stable notification
 * tags replace it in the browser. Unstarted recipients survive shutdown and feed deadlines.
 */
export class PushOutbox {
  private stopped = false;
  private scheduled = false;
  private active: Promise<void> | undefined;
  private timer: NodeJS.Timeout | undefined;
  private counters = { delivered: 0, errors: 0, retries: 0, dropped: 0 };

  start(): void {
    if (this.stopped || this.timer) return;
    context.runInAsyncScope(() => {
      this.timer = setInterval(() => this.kick(), 1000);
      this.timer.unref();
    });
    this.kick();
  }

  kick(): void {
    if (this.stopped || this.scheduled || this.active) return;
    this.scheduled = true;
    context.runInAsyncScope(() => setImmediate(() => {
      this.scheduled = false;
      if (this.stopped) return;
      this.active = this.step().catch(() => {
        // A failed progress write must not immediately repeat a delivery forever.
        this.stopped = true;
        if (this.timer) clearInterval(this.timer);
        console.error(JSON.stringify({ event: "push_outbox_error", code: "storage_or_eligibility_failure" }));
      }).finally(() => { this.active = undefined; });
      void this.active.then(() => {
        if (!this.stopped && this.nextEvent()) this.kick();
      }).catch(() => {
        this.stopped = true;
        if (this.timer) clearInterval(this.timer);
        console.error(JSON.stringify({ event: "push_outbox_error", code: "queue_storage_failure" }));
      });
    }));
  }

  private advanceSubscription(event: Event, subscriptionId: number): void {
    db.prepare(`UPDATE push_outbox SET subscription_cursor = ?, current_subscription = 0,
      device_cursor = 0, device_ceiling = 0, target_device = 0, attempts = 0, available_at = ? WHERE id = ?`)
      .run(subscriptionId, Date.now(), event.id);
  }

  private nextEvent(): Event | undefined {
    return db.prepare<[number], Event>(`SELECT p.* FROM push_outbox p WHERE available_at <= ?
      AND NOT EXISTS (SELECT 1 FROM push_outbox earlier WHERE earlier.feed_id = p.feed_id AND earlier.id < p.id)
      ORDER BY available_at, id LIMIT 1`).get(Date.now());
  }

  private async step(): Promise<void> {
    const event = this.nextEvent();
    if (!event) return;
    const subscription = db.prepare<[number, number, number], { id: number; user_id: number; label: string | null }>(`
      SELECT id,user_id,NULLIF(TRIM(label),'') label FROM subscriptions
      WHERE feed_id = ? AND id > ? AND id <= ? AND notify = 1 ORDER BY id LIMIT 1`)
      .get(event.feed_id, event.subscription_cursor, event.subscription_ceiling);
    if (!subscription) {
      db.prepare("DELETE FROM push_outbox WHERE id = ?").run(event.id);
      return;
    }
    // Revocation/unsubscribe/opt-out while waiting always takes effect before another delivery.
    if (!hasUserCapability(subscription.user_id, "sync")) {
      this.advanceSubscription(event, subscription.id);
      return;
    }
    if (subscription.id !== event.current_subscription) {
      event.device_cursor = 0;
      event.attempts = 0;
      event.device_ceiling = db.prepare<[number], { id: number }>("SELECT COALESCE(MAX(id),0) id FROM push_devices WHERE user_id = ?").get(subscription.user_id)!.id;
      db.prepare(`UPDATE push_outbox SET current_subscription = ?, device_cursor = 0, device_ceiling = ?, target_device = 0, attempts = 0 WHERE id = ?`)
        .run(subscription.id, event.device_ceiling, event.id);
    }
    const device = db.prepare<[number, number, number], { id: number; endpoint: string; p256dh: string; auth: string }>(`
      SELECT id,endpoint,p256dh,auth FROM push_devices WHERE user_id = ? AND id > ? AND id <= ? ORDER BY id LIMIT 1`)
      .get(subscription.user_id, event.device_cursor, event.device_ceiling);
    if (!device) { this.advanceSubscription(event, subscription.id); return; }
    // A removed/reassigned retry target must not consume the next device's retry budget.
    if (device.id !== event.target_device) {
      event.attempts = 0;
      db.prepare("UPDATE push_outbox SET target_device = ?, attempts = 0 WHERE id = ?").run(device.id, event.id);
    }
    const feed = db.prepare<[number], { id: number; title: string | null; url: string }>("SELECT id,title,url FROM feeds WHERE id = ?").get(event.feed_id);
    if (!feed) return; // Feed deletion cascades the event.
    const latest = db.prepare<[number, number, number], { id: number; title: string | null; content_snippet: string | null }>(`
      SELECT id,title,content_snippet FROM items WHERE feed_id = ? AND id <= ? ORDER BY id DESC LIMIT ?`)
      .all(event.feed_id, event.max_item_id, event.item_count);
    const payload = newItemsPushPayload(feed, subscription.user_id, subscription.label, latest);
    if (!payload) { this.advanceSubscription(event, subscription.id); return; }
    try {
      await sendPushTarget({ endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } }, payload);
      this.counters.delivered++;
    } catch (error) {
      this.counters.errors++;
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        // Do not remove a device if its ownership changed during I/O.
        db.prepare("DELETE FROM push_devices WHERE id = ? AND user_id = ?").run(device.id, subscription.user_id);
      } else if ((status === undefined || [408, 425, 429, 500, 502, 503, 504].includes(status)) && event.attempts < 2) {
        const headers = (error as { headers?: Record<string, string> }).headers;
        const retryAt = [429, 503].includes(status ?? 0) ? parseRetryAfter(headers?.["retry-after"] ?? null) ?? 0 : 0;
        const delay = Math.ceil(1000 * 2 ** event.attempts * (0.5 + Math.random() * 0.5));
        db.prepare("UPDATE push_outbox SET attempts = attempts + 1, available_at = ? WHERE id = ?")
          .run(Math.max(Date.now() + delay, retryAt), event.id);
        this.counters.retries++;
        return;
      } else this.counters.dropped++;
    }
    // Advance only after an attempted delivery. Round-robin events between device attempts.
    db.prepare("UPDATE push_outbox SET device_cursor = ?, target_device = 0, attempts = 0, available_at = ? WHERE id = ?")
      .run(device.id, Date.now(), event.id);
  }

  metrics() {
    const row = db.prepare<[number], { pending: number; oldestMs: number }>(
      "SELECT COUNT(*) pending, COALESCE(MAX(? - created_at),0) oldestMs FROM push_outbox",
    ).get(Date.now());
    return { ...row, running: this.active ? 1 : 0, ...this.counters };
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    // Finish at most the one device already in flight (absolute network deadline: 10 seconds).
    await this.active;
  }
}

let outbox: PushOutbox | undefined;
export function startPushOutbox(): void { outbox ??= new PushOutbox(); outbox.start(); outbox.kick(); }
export function pushOutboxMetrics() { return outbox?.metrics() ?? { pending: 0, running: 0 }; }
export async function stopPushOutbox(): Promise<void> { await outbox?.stop(); }
