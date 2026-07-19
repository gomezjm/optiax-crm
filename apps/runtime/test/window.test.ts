import { describe, expect, it } from 'vitest';
import { assertWithinWindow, isWithinWindow, OutsideWindowError } from '../src/wa/window.js';

const NOW = new Date('2026-07-19T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

describe('isWithinWindow', () => {
  it('inside: customer messaged less than 24h ago', () => {
    expect(isWithinWindow(hoursAgo(0), NOW)).toBe(true);
    expect(isWithinWindow(hoursAgo(23.98), NOW)).toBe(true);
  });

  it('outside: exactly 24h and beyond', () => {
    expect(isWithinWindow(hoursAgo(24), NOW)).toBe(false);
    expect(isWithinWindow(hoursAgo(25), NOW)).toBe(false);
    expect(isWithinWindow(hoursAgo(24 * 30), NOW)).toBe(false);
  });

  it('never messaged (null) → outside', () => {
    expect(isWithinWindow(null, NOW)).toBe(false);
  });

  it('unparseable timestamp → outside (fail closed)', () => {
    expect(isWithinWindow('not-a-date', NOW)).toBe(false);
  });
});

describe('assertWithinWindow', () => {
  it('passes inside the window', () => {
    expect(() =>
      assertWithinWindow({ id: 'c1', last_customer_message_at: hoursAgo(1) }, NOW),
    ).not.toThrow();
  });

  it('throws OutsideWindowError outside the window', () => {
    expect(() =>
      assertWithinWindow({ id: 'c1', last_customer_message_at: hoursAgo(30) }, NOW),
    ).toThrow(OutsideWindowError);
    expect(() => assertWithinWindow({ id: 'c1', last_customer_message_at: null }, NOW)).toThrow(
      OutsideWindowError,
    );
  });
});
