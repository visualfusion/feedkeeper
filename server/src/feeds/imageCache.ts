import { createHash } from "node:crypto";
import { link, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { FeedHttpError } from "./fetcher.js";
import type { ImageCacheSettings } from "./imageCacheSettings.js";
import { detectImageType } from "./imageTypes.js";
import { readPollSettings } from "./pollSettings.js";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const KEY = /^[0-9a-f]{64}$/;
type Entry = { key: string; size: number; expires: number; used: number };
export type CachedImage = { buffer: Buffer; mime: string; path?: string; cacheTtlMs?: number };
type Download = { buffer: Buffer; path?: string; cacheTtlMs?: number };
type Loader = (signal: AbortSignal) => Promise<Download>;

export class ImageCacheBusyError extends Error {
  constructor() { super("Image cache is busy"); }
}

/** A disposable disk cache, shared only within a feed. One process owns its directory. */
export class ImageCache {
  private readonly directory: string;
  private readonly entries = new Map<string, Entry>();
  private readonly negative = new Map<string, { expires: number; result: "unsupported" | 404 | 410 }>();
  private readonly running = new Map<string, { promise: Promise<CachedImage | "unsupported">; finished: Promise<void>; controller: AbortController }>();
  private readonly ready: Promise<void>;
  private readonly waiting: { run: () => void }[] = [];
  private active = 0;
  private writes: Promise<unknown> = Promise.resolve();
  private stopping = false;
  private diskAvailable = true;
  private bytes = 0;
  private readonly counters = { hits: 0, misses: 0, shared: 0, negativeHits: 0, busy: 0, errors: 0, storageErrors: 0, evictions: 0 };

  constructor(private readonly settings: ImageCacheSettings, private readonly now = Date.now) {
    this.directory = resolve(settings.path);
    this.ready = this.restore().catch(() => { this.diskAvailable = false; this.counters.storageErrors++; });
  }

  metrics() { return { ...this.counters, entries: this.entries.size, bytes: this.bytes, running: this.active, pending: this.waiting.length }; }

  async get(scope: number | string, url: string, load: Loader): Promise<CachedImage | "unsupported"> {
    if (this.stopping) throw new ImageCacheBusyError();
    const key = createHash("sha256").update(`${scope}\0${url}`).digest("hex");
    const missing = this.negative.get(key);
    if (missing) {
      if (missing.expires > this.now()) {
        this.counters.negativeHits++;
        if (missing.result === "unsupported") return "unsupported";
        throw new FeedHttpError(missing.result, undefined, "");
      }
      this.negative.delete(key);
    }
    const shared = this.running.get(key);
    if (shared) { this.counters.shared++; return shared.promise; }
    if (this.active >= this.settings.concurrency && this.waiting.length >= this.settings.maxWaiters) {
      this.counters.busy++;
      throw new ImageCacheBusyError();
    }
    const controller = new AbortController();
    let complete!: (image: CachedImage | "unsupported") => void;
    let fail!: (error: unknown) => void;
    let finishWork!: () => void;
    const promise = new Promise<CachedImage | "unsupported">((resolve, reject) => { complete = resolve; fail = reject; });
    const finished = new Promise<void>((resolve) => { finishWork = resolve; });
    let started = false;
    const deadline = setTimeout(() => controller.abort(new DOMException("Image deadline exceeded", "TimeoutError")), readPollSettings().requestTimeoutMs);
    deadline.unref();
    this.running.set(key, { promise, finished, controller });
    const cancelWaiting = () => {
      fail(controller.signal.reason);
      if (started) return; // Keep the slot until any outstanding I/O has actually stopped.
      const index = this.waiting.indexOf(job);
      if (index >= 0) this.waiting.splice(index, 1);
      this.running.delete(key);
      clearTimeout(deadline);
      finishWork();
    };
    const job = { run: () => {
      started = true;
      this.active++;
      const finish = () => {
        clearTimeout(deadline);
        controller.signal.removeEventListener("abort", cancelWaiting);
        this.active--;
        this.running.delete(key);
        finishWork();
        this.pump();
      };
      void this.resolve(key, load, controller.signal).then(
        (image) => { finish(); complete(image); },
        (error) => { finish(); fail(error); },
      );
    } };
    controller.signal.addEventListener("abort", cancelWaiting, { once: true });
    this.waiting.push(job);
    this.pump();
    return promise;
  }

  private pump(): void {
    while (this.active < this.settings.concurrency && this.waiting.length) this.waiting.shift()!.run();
  }

  async close(): Promise<void> {
    this.stopping = true;
    const jobs = [...this.running.values()];
    for (const { controller } of jobs) controller.abort();
    await this.ready;
    await Promise.allSettled(jobs.map(({ finished }) => finished));
    await this.writes;
    await this.serialize(() => this.saveIndex()).catch(() => undefined);
  }

  async prune(): Promise<void> {
    await this.ready;
    await this.serialize(async () => { await this.trim(); await this.saveIndex(); });
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.writes.then(work);
    this.writes = result.catch(() => { this.diskAvailable = false; this.counters.storageErrors++; });
    return result;
  }

  private file(key: string): string { return join(this.directory, `${key}.img`); }

  private async restore(): Promise<void> {
    if (!this.settings.maxBytes) { this.diskAvailable = false; return; }
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const index = join(this.directory, "index.json");
    let saved: unknown = [];
    try {
      if ((await stat(index)).size > 8 * 1024 * 1024) throw new Error("Oversized image cache index");
      saved = JSON.parse(await readFile(index, "utf8"));
    } catch { /* Missing or interrupted cache metadata is safe to discard. */ }
    if (Array.isArray(saved)) {
      for (const row of saved.slice(0, 20_000)) {
        if (!row || typeof row !== "object" || !KEY.test(row.key) || !Number.isSafeInteger(row.size) || row.size <= 0 || row.size > MAX_IMAGE_BYTES ||
            !Number.isFinite(row.expires) || !Number.isFinite(row.used) || row.expires <= this.now() || this.entries.has(row.key)) continue;
        try {
          if ((await stat(this.file(row.key))).size !== row.size) continue;
          this.entries.set(row.key, row);
          this.bytes += row.size;
        } catch { /* Missing files are cache misses. */ }
      }
    }
    await this.trim();
    for (const file of await readdir(this.directory)) {
      if ((/^[0-9a-f]{64}\.img$/.test(file) && !this.entries.has(file.slice(0, 64))) || /^[0-9a-f]{64}\.tmp$/.test(file) || file === "index.tmp") {
        await unlink(join(this.directory, file));
      }
    }
    await this.saveIndex();
  }

  private async resolve(key: string, load: Loader, signal: AbortSignal): Promise<CachedImage | "unsupported"> {
    await this.ready;
    signal.throwIfAborted();
    const missing = this.negative.get(key);
    if (missing && missing.expires > this.now()) {
      this.counters.negativeHits++;
      if (missing.result === "unsupported") return "unsupported";
      throw new FeedHttpError(missing.result, undefined, "");
    }
    this.negative.delete(key);
    const entry = this.entries.get(key);
    if (entry && entry.expires > this.now()) {
      try {
        const buffer = await readFile(this.file(key), { signal });
        const type = detectImageType(buffer);
        if (buffer.length === entry.size && type) {
          entry.used = this.now();
          this.counters.hits++;
          return { buffer, mime: type.mime, path: this.file(key), cacheTtlMs: Math.max(0, entry.expires - this.now()) };
        }
      } catch { /* Re-fetch evicted or damaged files through the guarded downloader. */ }
    }
    this.counters.misses++;
    try {
      signal.throwIfAborted();
      const image = await load(signal);
      signal.throwIfAborted();
      if (image.buffer.length > MAX_IMAGE_BYTES) throw new Error("Image exceeds the allowed size");
      const type = detectImageType(image.buffer);
      if (!type) { this.rememberNegative(key, "unsupported"); return "unsupported"; }
      const result: CachedImage = { buffer: image.buffer, mime: type.mime, path: image.path };
      const ttl = Math.min(this.settings.ttlMs, image.cacheTtlMs ?? this.settings.ttlMs);
      result.cacheTtlMs = ttl;
      if (this.diskAvailable && ttl > 0 && image.buffer.length <= this.settings.maxBytes) {
        try {
          await this.serialize(async () => {
            if (signal.aborted || !this.diskAvailable) return;
            await this.remove(key);
            await this.trim(image.buffer.length, 1);
            const temporary = join(this.directory, `${key}.tmp`);
            await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
            // Hard links let the cache and permanent archive share the same bytes.
            if (image.path) {
              await link(image.path, temporary).catch(() => writeFile(temporary, image.buffer, { mode: 0o600 }));
            } else await writeFile(temporary, image.buffer, { mode: 0o600 });
            await rename(temporary, this.file(key));
            this.entries.set(key, { key, size: image.buffer.length, expires: this.now() + ttl, used: this.now() });
            this.bytes += image.buffer.length;
            await this.saveIndex();
            result.path = this.file(key);
          });
        } catch {
          await unlink(join(this.directory, `${key}.tmp`)).catch(() => undefined);
          // A full or read-only cache must not break image delivery.
        }
      }
      return result;
    } catch (error) {
      this.counters.errors++;
      if (error instanceof FeedHttpError && (error.status === 404 || error.status === 410)) this.rememberNegative(key, error.status);
      throw error;
    }
  }

  private rememberNegative(key: string, result: "unsupported" | 404 | 410): void {
    if (!this.settings.negativeTtlMs) return;
    for (const [key, row] of this.negative) if (row.expires <= this.now()) this.negative.delete(key);
    while (this.negative.size >= this.settings.maxEntries) this.negative.delete(this.negative.keys().next().value!);
    this.negative.set(key, { result, expires: this.now() + this.settings.negativeTtlMs });
  }

  private async remove(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry) return;
    // Do not forget a file we could not remove: its bytes still count towards the limit.
    try { await unlink(this.file(key)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    this.entries.delete(key);
    this.bytes -= entry.size;
    this.counters.evictions++;
  }

  private async trim(extraBytes = 0, extraEntries = 0): Promise<void> {
    const oldest = [...this.entries.values()].sort((a, b) => a.used - b.used);
    for (const entry of oldest) if (entry.expires <= this.now()) await this.remove(entry.key);
    for (const entry of oldest) {
      if (this.bytes + extraBytes <= this.settings.maxBytes && this.entries.size + extraEntries <= this.settings.maxEntries) break;
      await this.remove(entry.key);
    }
  }

  private async saveIndex(): Promise<void> {
    if (!this.diskAvailable) return;
    await writeFile(join(this.directory, "index.tmp"), JSON.stringify([...this.entries.values()]), { mode: 0o600 });
    await rename(join(this.directory, "index.tmp"), join(this.directory, "index.json"));
  }
}
