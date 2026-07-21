/**
 * Per-tenant token bucket (ws-d3 §1): burst up to capacity, then refill at a
 * steady rate. Uses an injected clock so the timing is deterministic.
 */
import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '../src/http/rate-limit.js';

describe('createRateLimiter', () => {
  it('allows a burst up to capacity, then rejects', () => {
    const limiter = createRateLimiter({ capacity: 3, refillPerSecond: 1, now: () => 0 });
    expect(limiter.tryConsume('t1')).toBe(true);
    expect(limiter.tryConsume('t1')).toBe(true);
    expect(limiter.tryConsume('t1')).toBe(true);
    expect(limiter.tryConsume('t1')).toBe(false);
  });

  it('refills over time', () => {
    let clock = 0;
    const limiter = createRateLimiter({ capacity: 2, refillPerSecond: 1, now: () => clock });
    expect(limiter.tryConsume('t1')).toBe(true);
    expect(limiter.tryConsume('t1')).toBe(true);
    expect(limiter.tryConsume('t1')).toBe(false);
    clock = 1000; // one second → one token back
    expect(limiter.tryConsume('t1')).toBe(true);
    expect(limiter.tryConsume('t1')).toBe(false);
  });

  it('meters each key independently', () => {
    const limiter = createRateLimiter({ capacity: 1, refillPerSecond: 1, now: () => 0 });
    expect(limiter.tryConsume('a')).toBe(true);
    expect(limiter.tryConsume('a')).toBe(false);
    // A different tenant has its own full bucket.
    expect(limiter.tryConsume('b')).toBe(true);
  });

  it('never exceeds capacity no matter how long it idles', () => {
    let clock = 0;
    const limiter = createRateLimiter({ capacity: 2, refillPerSecond: 1, now: () => clock });
    clock = 1_000_000; // idle a long time
    expect(limiter.tryConsume('t1')).toBe(true);
    expect(limiter.tryConsume('t1')).toBe(true);
    expect(limiter.tryConsume('t1')).toBe(false);
  });
});
