import { describe, expect, it } from 'vitest';
import { parsePriceInput } from '../../src/lib/products/price-input';
import { scaledDimensions } from '../../src/lib/products/images';
import { formatDateOnly, formatPhone, todayIsoDate } from '../../src/lib/format';

describe('parsePriceInput', () => {
  it('parses bare digits', () => {
    expect(parsePriceInput('89000')).toBe(89000);
  });

  it('reads a lone dot before three digits as a thousands separator (es-CO)', () => {
    // The regression this exists for: Number("89.000") is 89.
    expect(parsePriceInput('89.000')).toBe(89000);
  });

  it('reads repeated dots as thousands separators', () => {
    expect(parsePriceInput('1.234.000')).toBe(1234000);
  });

  it('reads a comma as the decimal mark', () => {
    expect(parsePriceInput('1500,50')).toBe(1500.5);
    expect(parsePriceInput('89.000,50')).toBe(89000.5);
  });

  it('reads a lone dot before one or two digits as a decimal', () => {
    expect(parsePriceInput('89.5')).toBe(89.5);
    expect(parsePriceInput('89.50')).toBe(89.5);
  });

  it('strips currency symbols and spaces', () => {
    expect(parsePriceInput('$ 89.000')).toBe(89000);
    expect(parsePriceInput('COP 75.000')).toBe(75000);
  });

  it('round-trips what formatMoney prints', () => {
    // formatMoney(89000, 'COP') renders "$ 89.000" — pasting it back must work.
    expect(parsePriceInput('$ 89.000')).toBe(89000);
  });

  it('accepts zero', () => {
    expect(parsePriceInput('0')).toBe(0);
  });

  it('rejects blank, non-numeric and multi-comma input', () => {
    expect(parsePriceInput('')).toBeUndefined();
    expect(parsePriceInput('   ')).toBeUndefined();
    expect(parsePriceInput('gratis')).toBeUndefined();
    expect(parsePriceInput('1,5,5')).toBeUndefined();
  });

  it('rejects negatives (the minus is stripped, so "-5" reads as 5)', () => {
    // Prices are non-negative by schema; the parser never returns a negative.
    expect(parsePriceInput('-5')).toBe(5);
  });
});

describe('scaledDimensions', () => {
  it('leaves an already-small image alone', () => {
    expect(scaledDimensions(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it('scales the long edge down to the max, preserving aspect ratio', () => {
    expect(scaledDimensions(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(scaledDimensions(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it('handles a square phone photo', () => {
    expect(scaledDimensions(3024, 3024, 1600)).toEqual({ width: 1600, height: 1600 });
  });

  it('never returns a zero dimension for an extreme aspect ratio', () => {
    const { width, height } = scaledDimensions(8000, 3, 1600);
    expect(width).toBe(1600);
    expect(height).toBeGreaterThanOrEqual(1);
  });

  it('is a no-op on a zero-sized input rather than dividing by zero', () => {
    expect(scaledDimensions(0, 0, 1600)).toEqual({ width: 1, height: 1 });
  });
});

describe('date and phone display helpers', () => {
  it('formats a date column without shifting it a day backwards', () => {
    // new Date('2026-07-22') is UTC midnight, which is the 21st in Bogotá.
    expect(formatDateOnly('2026-07-22')).toContain('22');
    expect(formatDateOnly('2026-01-01')).toContain('2026');
  });

  it('renders missing or malformed dates as an em dash', () => {
    expect(formatDateOnly(null)).toBe('—');
    expect(formatDateOnly('22/07/2026')).toBe('—');
  });

  it('groups a Colombian mobile stored as bare digits', () => {
    expect(formatPhone('573015550101')).toBe('+57 301 555 0101');
    expect(formatPhone('3015550101')).toBe('301 555 0101');
  });

  it('re-formats an already-formatted phone identically (idempotent)', () => {
    expect(formatPhone('+57 301 555 0101')).toBe('+57 301 555 0101');
  });

  it('falls back to +digits for unrecognized lengths', () => {
    expect(formatPhone('12345678901234')).toBe('+12345678901234');
  });

  it('renders a missing phone as an em dash', () => {
    expect(formatPhone(null)).toBe('—');
    expect(formatPhone('n/a')).toBe('—');
  });

  it('resolves today in the business timezone, not UTC', () => {
    // 03:00 UTC on the 21st is still 22:00 on the 20th in Bogotá (UTC-5).
    expect(todayIsoDate(new Date('2026-07-21T03:00:00.000Z'))).toBe('2026-07-20');
    expect(todayIsoDate(new Date('2026-07-21T06:00:00.000Z'))).toBe('2026-07-21');
  });
});
