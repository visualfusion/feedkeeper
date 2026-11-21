import { Worker } from "node:worker_threads";
import type { WorkerExtractionResult } from "./extractorParser.js";

interface QueuedTask {
  id: number;
  html: string;
  url: string;
  signal?: AbortSignal;
  resolve: (result: WorkerExtractionResult) => void;
  reject: (error: Error) => void;
  abortListener?: () => void;
}

interface WorkerSlot {
  worker: Worker;
  busy: boolean;
  current: QueuedTask | null;
  timer: NodeJS.Timeout | null;
}

interface WorkerResponse {
  id: number;
  result?: WorkerExtractionResult;
  error?: string;
}

const PARSE_TIMEOUT_MS = 15_000;

function readWorkerCount(): number {
  const raw = process.env.EXTRACTOR_WORKERS;
  if (raw === undefined) return 2;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 4) return 2;
  return parsed;
}

function createWorker(): Worker {
  const isTs = import.meta.url.endsWith(".ts");
  const url = new URL(isTs ? "./extractorWorker.ts" : "./extractorWorker.js", import.meta.url);
  const worker = isTs ? new Worker(url, { execArgv: ["--import", "tsx"] }) : new Worker(url);
  worker.unref();
  return worker;
}

class ExtractorWorkerPool {
  private slots: WorkerSlot[] = [];
  private queue: QueuedTask[] = [];
  private nextId = 1;
  private stopped = false;

  private ensureCapacity(): void {
    const target = readWorkerCount();
    while (!this.stopped && this.slots.length < target && this.slots.length < this.queue.length + this.activeCount()) {
      this.slots.push(this.spawnSlot());
    }
  }

  private activeCount(): number {
    return this.slots.filter(slot => slot.busy).length;
  }

  private spawnSlot(): WorkerSlot {
    const worker = createWorker();
    const slot: WorkerSlot = { worker, busy: false, current: null, timer: null };

    worker.on("message", (msg: WorkerResponse) => {
      const task = slot.current;
      if (!task || task.id !== msg.id) return;
      this.finishSlot(slot);
      if (msg.error) task.reject(new Error(msg.error));
      else if (msg.result) task.resolve(msg.result);
      else task.reject(new Error("worker_empty_response"));
      this.pump();
    });

    const handleFailure = (reason: Error) => {
      const task = slot.current;
      this.dropSlot(slot);
      if (task) task.reject(reason);
      this.pump();
    };

    worker.on("error", err => handleFailure(err instanceof Error ? err : new Error(String(err))));
    worker.on("exit", code => {
      if (this.slots.includes(slot)) {
        handleFailure(new Error(`extractor_worker_exited_${code}`));
      }
    });

    return slot;
  }

  private finishSlot(slot: WorkerSlot): void {
    if (slot.timer) { clearTimeout(slot.timer); slot.timer = null; }
    const task = slot.current;
    if (task?.signal && task.abortListener) {
      task.signal.removeEventListener("abort", task.abortListener);
    }
    slot.current = null;
    slot.busy = false;
    slot.worker.unref();
  }

  private dropSlot(slot: WorkerSlot): void {
    if (slot.timer) { clearTimeout(slot.timer); slot.timer = null; }
    const task = slot.current;
    if (task?.signal && task.abortListener) {
      task.signal.removeEventListener("abort", task.abortListener);
    }
    slot.current = null;
    slot.busy = false;
    this.slots = this.slots.filter(entry => entry !== slot);
    void slot.worker.terminate().catch(() => {});
  }

  run(html: string, url: string, signal?: AbortSignal): Promise<WorkerExtractionResult> {
    if (this.stopped) return Promise.reject(new DOMException("Extractor pool stopped", "AbortError"));
    if (signal?.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"));

    return new Promise((resolve, reject) => {
      const task: QueuedTask = { id: this.nextId++, html, url, signal, resolve, reject };
      if (signal) {
        task.abortListener = () => {
          const idx = this.queue.indexOf(task);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
            reject(signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"));
            return;
          }
          const runningSlot = this.slots.find(s => s.current === task);
          if (runningSlot) {
            // Terminate a busy worker on abort/timeout so runaway DOM parsing cannot stall later tasks.
            this.dropSlot(runningSlot);
            reject(signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"));
            this.pump();
          }
        };
        signal.addEventListener("abort", task.abortListener, { once: true });
      }
      this.queue.push(task);
      this.pump();
    });
  }

  private pump(): void {
    if (this.stopped || this.queue.length === 0) return;
    this.ensureCapacity();
    for (const slot of this.slots) {
      if (slot.busy) continue;
      const task = this.queue.shift();
      if (!task) break;
      slot.busy = true;
      slot.current = task;
      slot.worker.ref();
      slot.timer = setTimeout(() => {
        if (slot.current !== task) return;
        this.dropSlot(slot);
        task.reject(new DOMException("Worker parse deadline exceeded", "TimeoutError"));
        this.pump();
      }, PARSE_TIMEOUT_MS);
      slot.worker.postMessage({ id: task.id, html: task.html, url: task.url });
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const task of this.queue.splice(0)) {
      if (task.signal && task.abortListener) task.signal.removeEventListener("abort", task.abortListener);
      task.reject(new DOMException("Extractor pool stopped", "AbortError"));
    }
    const closing = this.slots.splice(0);
    await Promise.all(closing.map(async slot => {
      if (slot.timer) clearTimeout(slot.timer);
      const task = slot.current;
      if (task?.signal && task.abortListener) task.signal.removeEventListener("abort", task.abortListener);
      if (task) task.reject(new DOMException("Extractor pool stopped", "AbortError"));
      await slot.worker.terminate().catch(() => {});
    }));
  }
}

let pool: ExtractorWorkerPool | undefined;

export function parseArticleInWorker(html: string, url: string, signal?: AbortSignal): Promise<WorkerExtractionResult> {
  pool ??= new ExtractorWorkerPool();
  return pool.run(html, url, signal);
}

export async function stopExtractorPool(): Promise<void> {
  if (!pool) return;
  const active = pool;
  pool = undefined;
  await active.stop();
}
