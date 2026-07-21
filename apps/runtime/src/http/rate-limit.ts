/**
 * Per-key in-memory token bucket (ws-d3 §1). The Playground calls real Gemini on
 * every message, so a single tenant hammering it costs real money; this caps the
 * burst and the sustained rate without any external dependency.
 *
 * In-memory is deliberate and sufficient: the runtime is one process today, and
 * a coarse per-tenant cap does not need cross-instance accuracy. A distributed
 * limiter is a Phase-5 concern if the service is ever horizontally scaled.
 */
export interface RateLimiter {
  /** Consume one token for `key`. Returns false when the bucket is empty. */
  tryConsume(key: string): boolean;
}

export interface RateLimiterOptions {
  /** Max tokens (burst size). */
  capacity: number;
  /** Tokens added per second (sustained rate). */
  refillPerSecond: number;
  /** Injectable clock for tests. Defaults to Date.now. */
  now?: () => number;
}

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const now = opts.now ?? Date.now;
  const buckets = new Map<string, Bucket>();

  return {
    tryConsume(key) {
      const t = now();
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { tokens: opts.capacity, lastRefill: t };
        buckets.set(key, bucket);
      } else {
        const elapsedSec = (t - bucket.lastRefill) / 1000;
        if (elapsedSec > 0) {
          bucket.tokens = Math.min(opts.capacity, bucket.tokens + elapsedSec * opts.refillPerSecond);
          bucket.lastRefill = t;
        }
      }
      if (bucket.tokens < 1) return false;
      bucket.tokens -= 1;
      return true;
    },
  };
}
