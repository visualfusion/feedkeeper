import { readPollSettings } from "./pollSettings.js";

export class PollDeferredError extends Error {
  constructor(public retryAt: number, public host: string) { super("poll_deferred"); }
}
export class RequestQueueFullError extends Error {
  constructor() { super("request_queue_full"); }
}
export class PollShutdownError extends Error {
  constructor() { super("poll_shutdown"); }
}

/** Hostname, deliberately excluding port and scheme; redirects acquire their destination too. */
export function sourceHost(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(/\.$/, "");
}

/** Someone waiting for an answer (subscribing, discovering, refreshing) goes before scheduled background work. */
export type RequestPriority = "interactive" | "background";

type Waiter = { host: string; signal: AbortSignal; priority: RequestPriority; resolve: (release: () => void) => void; reject: (error: Error) => void; abort: () => void };

/** Shared by feed downloads, discovery, probes and icons. Never holds a permit over a redirect or delay. */
export class RequestGate {
  private running = 0;
  private hosts = new Map<string, number>();
  private waiting: Waiter[] = [];
  private stopped = false;
  cooldown: (host: string) => number = () => 0;
  defer: (host: string, until: number) => void = () => {};
  // Integrations can load their .env after importing core modules. Freeze limits on first use,
  // after startup configuration, rather than capturing defaults during module evaluation.
  constructor(private settings?: ReturnType<typeof readPollSettings>) {}
  private get limits() { return this.settings ??= readPollSettings(); }

  get stats() { return { running: this.running, waiting: this.waiting.length }; }
  acquire(host: string, signal: AbortSignal, priority: RequestPriority = "background"): Promise<() => void> {
    if (this.stopped) return Promise.reject(new PollShutdownError());
    if (signal.aborted) return Promise.reject(signal.reason);
    const until = this.cooldown(host);
    if (until > Date.now()) return Promise.reject(new PollDeferredError(until, host));
    if (this.waiting.length >= this.limits.maxWaiters && !this.makeRoomFor(priority)) return Promise.reject(new RequestQueueFullError());
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { host, signal, priority, resolve, reject, abort: () => {
        this.waiting = this.waiting.filter(entry => entry !== waiter);
        reject(signal.reason);
      } };
      signal.addEventListener("abort", waiter.abort, { once: true });
      // Interactive requests queue behind earlier interactive ones but ahead of all background work.
      const index = priority === "interactive" ? this.waiting.findIndex(entry => entry.priority === "background") : -1;
      if (index === -1) this.waiting.push(waiter); else this.waiting.splice(index, 0, waiter);
      this.pump();
    });
  }
  /** A full queue still admits an interactive request by turning away the most recent background one. */
  private makeRoomFor(priority: RequestPriority): boolean {
    if (priority !== "interactive") return false;
    for (let i = this.waiting.length - 1; i >= 0; i--) {
      if (this.waiting[i].priority !== "background") continue;
      const [evicted] = this.waiting.splice(i, 1);
      evicted.signal.removeEventListener("abort", evicted.abort);
      evicted.reject(new RequestQueueFullError());
      return true;
    }
    return false;
  }
  private pump() {
    for (let i = 0; i < this.waiting.length;) {
      const waiter = this.waiting[i];
      const until = this.cooldown(waiter.host);
      if (until > Date.now()) {
        this.waiting.splice(i, 1);
        waiter.signal.removeEventListener("abort", waiter.abort);
        waiter.reject(new PollDeferredError(until, waiter.host));
        continue;
      }
      if (this.running >= this.limits.concurrency || (this.hosts.get(waiter.host) ?? 0) >= this.limits.hostConcurrency) { i++; continue; }
      this.waiting.splice(i, 1);
      waiter.signal.removeEventListener("abort", waiter.abort);
      this.running++;
      this.hosts.set(waiter.host, (this.hosts.get(waiter.host) ?? 0) + 1);
      let released = false;
      waiter.resolve(() => {
        if (released) return;
        released = true;
        this.running--;
        const count = this.hosts.get(waiter.host)! - 1;
        if (count) this.hosts.set(waiter.host, count); else this.hosts.delete(waiter.host);
        this.pump();
      });
    }
  }
  stop() {
    this.stopped = true;
    for (const waiter of this.waiting.splice(0)) {
      waiter.signal.removeEventListener("abort", waiter.abort);
      waiter.reject(new PollShutdownError());
    }
  }
}
export const feedRequests = new RequestGate();
