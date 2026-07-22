import { describe, expect, it } from 'vitest';
import { dayCutoff } from '../src/segments/date-bounds.js';

// Colombia is UTC−05 year-round (no DST), so a local midnight is 05:00Z.
const BOGOTA = 'America/Bogota';

describe('dayCutoff', () => {
  it('anchors to the start of the local day N days before today', () => {
    const now = new Date('2026-07-21T12:00:00Z'); // 07:00 local
    const c = dayCutoff(now, BOGOTA, 30);
    expect(c.dateIso).toBe('2026-06-21');
    expect(c.instantIso).toBe('2026-06-21T05:00:00.000Z');
  });

  it('is stable across the local day (does not roll with the hour)', () => {
    const early = dayCutoff(new Date('2026-07-21T05:30:00Z'), BOGOTA, 30); // 00:30 local
    const late = dayCutoff(new Date('2026-07-22T04:30:00Z'), BOGOTA, 30); // 23:30 local, same day
    expect(early.dateIso).toBe('2026-06-21');
    expect(late.dateIso).toBe('2026-06-21');
    expect(early.instantIso).toBe(late.instantIso);
  });

  it('uses the tenant timezone, not UTC, to decide "today"', () => {
    // 02:00Z on the 21st is still the 20th at 21:00 in Bogotá.
    const now = new Date('2026-07-21T02:00:00Z');
    const c = dayCutoff(now, BOGOTA, 0);
    expect(c.dateIso).toBe('2026-07-20');
    expect(c.instantIso).toBe('2026-07-20T05:00:00.000Z');
  });

  it('rolls month and year boundaries correctly', () => {
    const c = dayCutoff(new Date('2026-01-05T12:00:00Z'), BOGOTA, 10);
    expect(c.dateIso).toBe('2025-12-26');
  });

  it('honors a different timezone', () => {
    // Tokyo is UTC+09; local midnight is 15:00Z the previous day.
    const now = new Date('2026-07-21T12:00:00Z'); // 21:00 local Tokyo
    const c = dayCutoff(now, 'Asia/Tokyo', 1);
    expect(c.dateIso).toBe('2026-07-20');
    expect(c.instantIso).toBe('2026-07-19T15:00:00.000Z');
  });

  it('is deterministic for a fixed now', () => {
    const now = new Date('2026-07-21T12:00:00Z');
    expect(dayCutoff(now, BOGOTA, 7)).toEqual(dayCutoff(now, BOGOTA, 7));
  });
});
