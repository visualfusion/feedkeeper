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

type Waiter = { host: string; signal: AbortSignal; resolve: (release: () => void) => void; reject: (error: Error) => void; abort: () => void };

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
  acquire(host: string, signal: AbortSignal): Promise<() => void> {
    if (this.stopped) return Promise.reject(new PollShutdownError());
    if (signal.aborted) return Promise.reject(signal.reason);
    const until = this.cooldown(host);
    if (until > Date.now()) return Promise.reject(new PollDeferredError(until, host));
    if (this.waiting.length >= this.limits.maxWaiters) return Promise.reject(new RequestQueueFullError());
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { host, signal, resolve, reject, abort: () => {
        this.waiting = this.waiting.filter(entry => entry !== waiter);
        reject(signal.reason);
      } };
      signal.addEventListener("abort", waiter.abort, { once: true });
      this.waiting.push(waiter);
      this.pump();
    });
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
