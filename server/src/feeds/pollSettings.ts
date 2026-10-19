/** Kept independent of application config so the guarded downloader also works in CLI tools. */
function integer(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function readPollSettings() {
  return {
    concurrency: integer("POLL_CONCURRENCY", 4, 1, 32),
    hostConcurrency: integer("POLL_HOST_CONCURRENCY", 2, 1, 8),
    maxWaiters: integer("POLL_MAX_WAITERS", 64, 1, 1024),
    requestTimeoutMs: integer("POLL_REQUEST_TIMEOUT_MS", 15_000, 50, 60_000),
    attemptTimeoutMs: integer("POLL_ATTEMPT_TIMEOUT_MS", 30_000, 100, 120_000),
    maxRetries: integer("POLL_MAX_RETRIES", 2, 0, 5),
    retryBaseMs: integer("POLL_RETRY_BASE_MS", 5_000, 10, 300_000),
    retryMaxMs: integer("POLL_RETRY_MAX_MS", 300_000, 100, 3_600_000),
    tickMs: integer("POLL_TICK_MS", 1_000, 20, 60_000),
  };
}
export type PollSettings = ReturnType<typeof readPollSettings>;
