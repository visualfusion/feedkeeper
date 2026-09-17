import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

// Blocks feed URLs that resolve to internal/private infrastructure so a user
// cannot make this server probe its own host or internal network (SSRF).
const BLOCKED_IPV4_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local / cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4], // multicast
];

function ipToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function isBlockedIPv4(ip: string): boolean {
  const target = ipToInt(ip);
  return BLOCKED_IPV4_RANGES.some(([base, prefix]) => {
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    return (target & mask) === (ipToInt(base) & mask);
  });
}

function isBlockedIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return (
    normalized === "::1" ||
    normalized.startsWith("fe80:") || // link-local
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") || // unique local
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}

export class SsrfBlockedError extends Error {
  constructor(url: string) {
    super(`Refusing to fetch "${url}": resolves to a blocked internal address`);
    this.name = "SsrfBlockedError";
  }
}

export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http:// and https:// URLs are allowed");
  }

  const hostname = url.hostname;
  const version = isIP(hostname);

  if (version === 4 && isBlockedIPv4(hostname)) throw new SsrfBlockedError(rawUrl);
  if (version === 6 && isBlockedIPv6(hostname)) throw new SsrfBlockedError(rawUrl);

  if (version === 0) {
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
      throw new SsrfBlockedError(rawUrl);
    }
    const resolved = await lookup(hostname, { all: true });
    for (const { address, family } of resolved) {
      if (family === 4 && isBlockedIPv4(address)) throw new SsrfBlockedError(rawUrl);
      if (family === 6 && isBlockedIPv6(address)) throw new SsrfBlockedError(rawUrl);
    }
  }

  return url;
}
