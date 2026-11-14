import { sourceHost } from "./requestGate.js";

const BLOCK_THRESHOLD = 3;
const BLOCK_WINDOW_MS = 5 * 60_000;
const PAUSE_MS = 30 * 60_000;
const MAX_TRACKED_HOSTS = 1024;
const hosts = new Map<string, { failures: number; expiresAt: number }>();

export function recordFullTextBlock(host: string, now = Date.now()): void {
  const previous = hosts.get(host);
  const current = previous && previous.expiresAt > now ? previous : undefined;
  if (current && current.failures >= BLOCK_THRESHOLD) return;
  const failures = (current?.failures ?? 0) + 1;
  const expiresAt = failures >= BLOCK_THRESHOLD ? now + PAUSE_MS : current?.expiresAt ?? now + BLOCK_WINDOW_MS;
  hosts.delete(host);
  if (hosts.size >= MAX_TRACKED_HOSTS) hosts.delete(hosts.keys().next().value!);
  hosts.set(host, { failures, expiresAt });
}

export function clearFullTextBlocks(host: string): void {
  hosts.delete(host);
}

export function isBackgroundFullTextPaused(host: string, now = Date.now()): boolean {
  const state = hosts.get(host);
  return !!state && state.expiresAt > now && state.failures >= BLOCK_THRESHOLD;
}

export function pruneFullTextBlocks(now = Date.now()): number {
  let paused = 0;
  for (const [host, state] of hosts) {
    if (state.expiresAt <= now) hosts.delete(host);
    else if (state.failures >= BLOCK_THRESHOLD) paused++;
  }
  return paused;
}

export function isBackgroundFullTextLinkPaused(link: string): boolean {
  if (!hosts.size) return false;
  try {
    return isBackgroundFullTextPaused(sourceHost(link));
  } catch {
    return false;
  }
}
