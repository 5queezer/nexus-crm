import { LRUCache } from "lru-cache";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// One cache per route group, keyed by IP
const caches = {
  auth: new LRUCache<string, RateLimitEntry>({ max: 500 }),
  applications: new LRUCache<string, RateLimitEntry>({ max: 500 }),
  documents: new LRUCache<string, RateLimitEntry>({ max: 500 }),
  general: new LRUCache<string, RateLimitEntry>({ max: 500 }),
} as const;

type RouteGroup = keyof typeof caches;

const LIMITS: Record<RouteGroup, { max: number; windowMs: number }> = {
  auth: { max: 10, windowMs: 60_000 },
  applications: { max: 60, windowMs: 60_000 },
  documents: { max: 30, windowMs: 60_000 },
  general: { max: 30, windowMs: 60_000 },
};

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function checkRateLimit(ip: string, group: RouteGroup): RateLimitResult {
  const cache = caches[group];
  const { max, windowMs } = LIMITS[group];
  const now = Date.now();

  const entry = cache.get(ip);

  if (!entry || now >= entry.resetAt) {
    cache.set(ip, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: max - 1, resetAt: now + windowMs };
  }

  if (entry.count >= max) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count += 1;
  return { allowed: true, remaining: max - entry.count, resetAt: entry.resetAt };
}
