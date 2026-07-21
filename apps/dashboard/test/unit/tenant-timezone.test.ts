/**
 * Tenant-timezone "today" boundaries (WS-D4 §3/§4). Proves the boundary math is
 * timezone-aware, not hardcoded to Colombia: a non-Colombian tz must move the
 * day window. This is what makes "Ventas de hoy" correct once a tenant onboards
 * outside UTC-5.
 */
import { describe, expect, it } from 'vitest';
import { tenantDayBoundsUtc, todayIsoDate } from '../../src/lib/format';

describe('tenantDayBoundsUtc', () => {
  it('brackets a full 24h day in Bogotá (UTC-5, no DST)', () => {
    const now = new Date('2026-07-21T18:00:00.000Z'); // 1pm in Bogotá
    const { start, end } = tenantDayBoundsUtc(now, 'America/Bogota');
    // Local midnight the 21st is 05:00Z; next local midnight is 05:00Z the 22nd.
    expect(start).toBe('2026-07-21T05:00:00.000Z');
    expect(end).toBe('2026-07-22T05:00:00.000Z');
  });

  it('moves the window for a non-Colombian tz (Tokyo, UTC+9)', () => {
    const now = new Date('2026-07-21T18:00:00.000Z'); // already the 22nd, 3am in Tokyo
    const { start, end } = tenantDayBoundsUtc(now, 'Asia/Tokyo');
    // Local midnight the 22nd in Tokyo is 15:00Z the 21st.
    expect(start).toBe('2026-07-21T15:00:00.000Z');
    expect(end).toBe('2026-07-22T15:00:00.000Z');
  });

  it('an instant near UTC midnight lands on different local days per tz', () => {
    const now = new Date('2026-07-21T03:00:00.000Z'); // 10pm the 20th in Bogotá
    expect(todayIsoDate(now, 'America/Bogota')).toBe('2026-07-20');
    expect(todayIsoDate(now, 'Asia/Tokyo')).toBe('2026-07-21'); // noon the 21st in Tokyo
    const bogota = tenantDayBoundsUtc(now, 'America/Bogota');
    const tokyo = tenantDayBoundsUtc(now, 'Asia/Tokyo');
    expect(bogota.start).not.toBe(tokyo.start);
  });

  it('handles a DST-observing zone correctly (Los Angeles in July, UTC-7)', () => {
    const now = new Date('2026-07-21T18:00:00.000Z'); // 11am PDT
    const { start } = tenantDayBoundsUtc(now, 'America/Los_Angeles');
    // PDT midnight the 21st is 07:00Z.
    expect(start).toBe('2026-07-21T07:00:00.000Z');
  });
});
