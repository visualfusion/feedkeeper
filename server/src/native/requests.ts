import cron from "node-cron";
import { createHash } from "node:crypto";
import { db } from "../db/index.js";

export class NativeError extends Error {
  constructor(public code: string, public status = 400, public current?: unknown) {
    super(code);
  }
}

/** An operation and its receipt commit together. Replays return the original result,
 * even after newer changes; reusing an ID with a different payload is rejected. */
export function nativeRequest<T>(userId: number, requestId: string | undefined, operation: string, input: unknown, action: () => T, now = new Date()): T {
  return db.transaction(() => {
    const fingerprint = createHash("sha256").update(JSON.stringify([operation, input])).digest("hex");
    if (requestId) {
      const receipt = db.prepare<[number, string], { fingerprint: string; response: string }>(
        "SELECT fingerprint, response FROM native_requests WHERE user_id = ? AND request_id = ?",
      ).get(userId, requestId);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw new NativeError("request_id_reused", 409);
        return JSON.parse(receipt.response) as T;
      }
    }
    const result = action();
    if (requestId) {
      db.prepare("INSERT INTO native_requests (user_id, request_id, fingerprint, response, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(userId, requestId, fingerprint, JSON.stringify(result), now.toISOString());
    }
    return result;
  })();
}

/** Receipts outlive the native offline window; publication metadata stays in the edition slot. */
export function startNativeRequestCleanup(): void {
  cron.schedule("0 * * * *", () => {
    db.prepare("DELETE FROM native_requests WHERE created_at < ?")
      .run(new Date(Date.now() - 35 * 86_400_000).toISOString());
  });
}
