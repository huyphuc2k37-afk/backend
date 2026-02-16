import NodeCache from "node-cache";

/**
 * In-memory cache for hot endpoints.
 *
 * stdTTL: default time-to-live in seconds
 * checkperiod: interval to delete expired entries
 * maxKeys: prevent memory leaks
 */
const cache = new NodeCache({
  stdTTL: 300,       // 5 minutes default
  checkperiod: 60,   // check every 60 seconds
  maxKeys: 5000,     // max entries
});

/** Short-lived cache for very dynamic data (1 minute) */
export const SHORT_TTL = 60;

/** Medium cache for rankings/listings (5 minutes) */
export const MEDIUM_TTL = 300;

/** Long cache for semi-static data (30 minutes) */
export const LONG_TTL = 1800;

/**
 * Get or compute a cached value.
 * If key exists in cache, return it immediately.
 * Otherwise call `compute()`, cache the result, and return it.
 */
export async function cached<T>(
  key: string,
  ttl: number,
  compute: () => Promise<T>
): Promise<T> {
  const existing = cache.get<T>(key);
  if (existing !== undefined) return existing;

  const result = await compute();
  cache.set(key, result, ttl);
  return result;
}

/**
 * Invalidate one or more cache keys.
 * Supports wildcard prefix invalidation with `prefix*` pattern.
 */
export function invalidateCache(...patterns: string[]): void {
  for (const pattern of patterns) {
    if (pattern.endsWith("*")) {
      const prefix = pattern.slice(0, -1);
      const keys = cache.keys().filter((k) => k.startsWith(prefix));
      cache.del(keys);
    } else {
      cache.del(pattern);
    }
  }
}

export default cache;
