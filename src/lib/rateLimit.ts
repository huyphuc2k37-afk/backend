/**
 * Per-key in-memory rate limiter used for endpoints where the global
 * `express-rate-limit` is too coarse (e.g. search suggestions, where one
 * chatty user shouldn't lock out the rest of the IP space, and we want a
 * separate budget for authenticated vs anonymous users).
 *
 * Sliding-window implementation:
 *   - Keep a list of recent timestamps per key (capped at `maxEvents`).
 *   - On each call, drop timestamps older than `windowMs`.
 *   - If remaining count >= `max`, reject.
 *   - Otherwise append the new timestamp and accept.
 *
 * Memory is bounded because we evict the oldest entry once the list is full.
 */
export interface RateLimitConfig {
  windowMs: number;
  max: number;
  maxEvents?: number;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
}

interface Bucket {
  // Sorted ascending by insertion time.
  events: number[];
}

const buckets = new Map<string, Bucket>();

/** Periodically prune buckets that have gone idle to keep the map small. */
const PRUNE_INTERVAL_MS = 5 * 60 * 1000;
const IDLE_BUCKET_MS = 10 * 60 * 1000;

function prune() {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    const last = bucket.events[bucket.events.length - 1] ?? 0;
    if (now - last > IDLE_BUCKET_MS) buckets.delete(key);
  }
}

const pruneTimer = setInterval(prune, PRUNE_INTERVAL_MS);
// Allow the Node process to exit even if the timer is still scheduled.
if (typeof (pruneTimer as { unref?: () => void }).unref === "function") {
  (pruneTimer as { unref: () => void }).unref();
}

export function rateLimit(key: string, cfg: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const windowStart = now - cfg.windowMs;
  const cap = cfg.maxEvents ?? Math.max(cfg.max * 2, 32);
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { events: [] };
    buckets.set(key, bucket);
  }

  // Drop events outside the window. Events are sorted ascending so we can
  // bail out as soon as we hit the first in-window timestamp.
  while (bucket.events.length > 0 && bucket.events[0] < windowStart) {
    bucket.events.shift();
  }

  if (bucket.events.length >= cfg.max) {
    const oldest = bucket.events[0];
    return {
      ok: false,
      remaining: 0,
      retryAfterMs: Math.max(0, oldest + cfg.windowMs - now),
    };
  }

  bucket.events.push(now);

  // Bound the per-bucket array.
  if (bucket.events.length > cap) {
    bucket.events.splice(0, bucket.events.length - cap);
  }

  return {
    ok: true,
    remaining: cfg.max - bucket.events.length,
    retryAfterMs: 0,
  };
}

/** For tests / hot reloads only. */
export function _resetRateLimit() {
  buckets.clear();
}