import { describe, expect, it } from 'vitest';
import { shouldRecordStatus } from '../src/wa/status-rank.js';

type S = Parameters<typeof shouldRecordStatus>[1];
const ALL: S[] = ['accepted', 'sent', 'delivered', 'read', 'failed'];

describe('shouldRecordStatus', () => {
  it('records anything over an empty status', () => {
    for (const incoming of ALL) expect(shouldRecordStatus(null, incoming)).toBe(true);
  });

  it('only advances rank: accepted < sent < delivered < read', () => {
    const expected: Array<[S, S, boolean]> = [
      ['accepted', 'accepted', false],
      ['accepted', 'sent', true],
      ['accepted', 'delivered', true],
      ['accepted', 'read', true],
      ['sent', 'accepted', false],
      ['sent', 'sent', false],
      ['sent', 'delivered', true],
      ['sent', 'read', true],
      ['delivered', 'accepted', false],
      ['delivered', 'sent', false],
      ['delivered', 'delivered', false],
      ['delivered', 'read', true],
      ['read', 'accepted', false],
      ['read', 'sent', false],
      ['read', 'delivered', false],
      ['read', 'read', false],
    ];
    for (const [current, incoming, want] of expected) {
      expect(shouldRecordStatus(current, incoming), `${current} → ${incoming}`).toBe(want);
    }
  });

  it('late delivered never overwrites read (the P1-Q4 case)', () => {
    expect(shouldRecordStatus('read', 'delivered')).toBe(false);
  });

  it('failed is terminal-recordable from any state', () => {
    for (const current of [null, 'accepted', 'sent', 'delivered', 'read'] as const) {
      expect(shouldRecordStatus(current, 'failed'), `${current} → failed`).toBe(true);
    }
  });

  it('failed is never downgraded', () => {
    for (const incoming of ALL) expect(shouldRecordStatus('failed', incoming)).toBe(false);
  });
});
