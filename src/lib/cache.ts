/**
 * Simple in-memory cache with TTL. Acts as a Redis fallback.
 * For high-traffic production, swap this with `ioredis` and keep the same interface.
 */

interface CacheEntry<T = unknown> {
  value: T;
  expiresAt: number;
}

class MemoryCache {
  private store = new Map<string, CacheEntry>();
  private hits = 0;
  private misses = 0;

  constructor(private readonly maxEntries = 10_000) {
    setInterval(() => this.evictExpired(), 60_000).unref?.();
  }

  get<T = unknown>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    return entry.value as T;
  }

  set<T = unknown>(key: string, value: T, ttlSeconds = 60): void {
    if (this.store.size >= this.maxEntries) {
      const firstKey = this.store.keys().next().value;
      if (firstKey) this.store.delete(firstKey);
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  /** Invalidate keys matching a prefix */
  deleteByPrefix(prefix: string): number {
    let count = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }

  clear(): void {
    this.store.clear();
  }

  /** Legacy alias used by older callers/tests */
  flushAll(): void {
    this.store.clear();
  }

  stats() {
    return {
      size: this.store.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0 ? this.hits / (this.hits + this.misses) : 0,
    };
  }

  private evictExpired() {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt < now) this.store.delete(key);
    }
  }
}

export const cache = new MemoryCache();
export default cache;

// TTL constants used across routes
export const SHORT_TTL = 60;          // 1 minute - for fast-changing lists
export const MEDIUM_TTL = 300;        // 5 minutes - for rankings, recommendations
export const LONG_TTL = 3600;         // 1 hour - for categories, tags

export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const existing = cache.get<T>(key);
  if (existing !== undefined) return existing;
  const value = await fetcher();
  cache.set(key, value, ttlSeconds);
  return value;
}

/** Invalidate all keys whose key starts with one of the given prefixes. */
export function invalidateCache(...prefixes: string[]): number {
  let total = 0;
  for (const p of prefixes) total += cache.deleteByPrefix(p);
  return total;
}

export function invalidatePattern(prefix: string): number {
  return cache.deleteByPrefix(prefix);
}
