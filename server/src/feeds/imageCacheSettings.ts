import { dirname, join } from "node:path";

function integer(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const value = env[name] === undefined ? fallback : Number(env[name]);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return value;
}

export function readImageCacheSettings(env: NodeJS.ProcessEnv = process.env) {
  return {
    path: env.IMAGE_CACHE_PATH ?? join(dirname(env.DATABASE_PATH ?? "./data/feedkeeper.sqlite"), "image-cache"),
    maxBytes: integer(env, "IMAGE_CACHE_MAX_BYTES", 256 * 1024 * 1024, 0, 1024 ** 4),
    maxEntries: integer(env, "IMAGE_CACHE_MAX_ENTRIES", 2_000, 1, 20_000),
    ttlMs: integer(env, "IMAGE_CACHE_TTL_SECONDS", 21_600, 1, 604_800) * 1_000,
    negativeTtlMs: integer(env, "IMAGE_CACHE_NEGATIVE_TTL_SECONDS", 60, 0, 300) * 1_000,
    concurrency: integer(env, "IMAGE_CACHE_CONCURRENCY", 4, 1, 32),
    maxWaiters: integer(env, "IMAGE_CACHE_MAX_WAITERS", 32, 0, 256),
  };
}

export type ImageCacheSettings = ReturnType<typeof readImageCacheSettings>;
