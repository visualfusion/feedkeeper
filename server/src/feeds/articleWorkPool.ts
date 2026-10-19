export class ArticleWorkBusyError extends Error {
  constructor() { super("article_work_busy"); }
}

export class ArticleAccessDeniedError extends Error {}

export class ArticleHostBusyError extends Error {
  constructor(readonly host: string, readonly retryAt: number) { super("article_host_busy"); }
}

type Waiting = { host: string; priority: number; added: number; start: () => void; reject: (error: Error) => void; controller: AbortController; timer: NodeJS.Timeout };
export type ArticleWorkLimits = { concurrency: number; hostConcurrency: number; maxWaiting: number; timeoutMs: number; agingMs: number };

export function readArticleWorkLimits(env = process.env): ArticleWorkLimits {
  const integer = (name: string, fallback: number, min: number, max: number) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}`);
    return value;
  };
  return {
    concurrency: integer("FULLTEXT_CONCURRENCY", 2, 1, 8),
    hostConcurrency: integer("FULLTEXT_HOST_CONCURRENCY", 1, 1, 4),
    maxWaiting: integer("FULLTEXT_MAX_WAITING", 32, 0, 128),
    timeoutMs: integer("FULLTEXT_TIMEOUT_MS", 20_000, 50, 60_000),
    agingMs: integer("FULLTEXT_AGING_MS", 60_000, 50, 600_000),
  };
}

/** A bounded admission pool shared by saved links and stored-article extraction. */
export class ArticleWorkPool {
  private waiting: Waiting[] = [];
  private active = new Map<AbortController, string>();
  private deadlines = new Map<AbortController, number>();
  private closing = false;
  private completed = 0;
  private failed = 0;
  private durationMs = 0;
  private drained: (() => void)[] = [];
  constructor(readonly limits: ArticleWorkLimits, private now = Date.now) {}
  cooldown: (host: string) => number = () => 0;
  get isClosing() { return this.closing; }
  metrics() { return { running: this.active.size, waiting: this.waiting.length, completed: this.completed, failed: this.failed, durationMs: this.durationMs }; }
  canStart(host: string) {
    return !this.closing && this.cooldown(host) <= this.now() && this.active.size < this.limits.concurrency && [...this.active.values()].filter(value => value === host).length < this.limits.hostConcurrency;
  }
  move(signal: AbortSignal, host: string) {
    const until = this.cooldown(host);
    if (until > this.now()) throw new ArticleHostBusyError(host, until);
    const controller = [...this.active.keys()].find(entry => entry.signal === signal);
    if (!controller || this.active.get(controller) === host) return;
    const occupied = [...this.active.entries()].filter(([, current]) => current === host);
    if (occupied.length >= this.limits.hostConcurrency) {
      throw new ArticleHostBusyError(host, Math.min(this.now() + 1000, ...occupied.map(([entry]) => this.deadlines.get(entry)!)));
    }
    this.active.set(controller, host);
  }
  run<T>(host: string, work: (signal: AbortSignal) => Promise<T>, priority = 5): Promise<T> {
    const until = this.cooldown(host);
    if (until > this.now()) return Promise.reject(new ArticleHostBusyError(host, until));
    if (this.closing || (!this.canStart(host) && this.waiting.length >= this.limits.maxWaiting)) return Promise.reject(new ArticleWorkBusyError());
    const controller = new AbortController();
    const added = this.now();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        controller.abort(new DOMException("Article deadline exceeded", "TimeoutError"));
        const index = this.waiting.indexOf(job);
        if (index >= 0) { this.waiting.splice(index, 1); reject(controller.signal.reason); }
      }, this.limits.timeoutMs);
      const job: Waiting = { host, priority, added, timer, controller, reject, start: () => {
        this.active.set(controller, host);
        this.deadlines.set(controller, added + this.limits.timeoutMs);
        const finish = () => {
          clearTimeout(timer);
          this.active.delete(controller);
          this.deadlines.delete(controller);
          this.completed++; this.durationMs += this.now() - added;
          this.pump();
          if (!this.active.size) this.drained.splice(0).forEach(done => done());
        };
        void Promise.resolve().then(() => work(controller.signal)).then(
          value => {
            if (this.now() - added >= this.limits.timeoutMs) {
              this.failed++; finish(); reject(new DOMException("Article deadline exceeded", "TimeoutError"));
            } else { finish(); resolve(value); }
          },
          error => { this.failed++; finish(); reject(error); },
        );
      } };
      this.waiting.push(job);
      this.pump();
    });
  }
  private pump() {
    this.waiting.sort((a, b) => (b.priority + Math.floor((this.now() - b.added) / this.limits.agingMs)) -
      (a.priority + Math.floor((this.now() - a.added) / this.limits.agingMs)) || a.added - b.added);
    for (let index = 0; index < this.waiting.length;) {
      const job = this.waiting[index];
      const until = this.cooldown(job.host);
      if (until > this.now()) {
        this.waiting.splice(index, 1); clearTimeout(job.timer); job.reject(new ArticleHostBusyError(job.host, until)); continue;
      }
      if (!this.canStart(job.host)) { index++; continue; }
      this.waiting.splice(index, 1); job.start();
    }
  }
  async close() {
    this.closing = true;
    for (const job of this.waiting.splice(0)) { clearTimeout(job.timer); job.reject(new ArticleWorkBusyError()); }
    for (const controller of this.active.keys()) controller.abort();
    if (this.active.size) await new Promise<void>(resolve => this.drained.push(resolve));
  }
}

let shared: ArticleWorkPool | undefined;
export function articleWorkPool() { return shared ??= new ArticleWorkPool(readArticleWorkLimits()); }

export function restartArticleWorkPool() { if (shared?.isClosing) shared = undefined; }
