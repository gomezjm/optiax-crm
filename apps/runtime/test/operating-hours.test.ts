import { describe, expect, it } from 'vitest';
import { isAgentActive, isInSchedule } from '../src/worker/operating-hours.js';
import { makeAgentConfig } from './fakes.js';

// 2026-07-19 = Sunday, 07-20 = Monday, 07-21 = Tuesday (verified).
const BOGOTA = 'America/Bogota'; // UTC-5, no DST
const WEEKDAYS_9_TO_17 = { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' };

describe('isInSchedule — normal ranges', () => {
  it('inside business hours in the tenant timezone', () => {
    // Mon 10:00 Bogota (15:00Z)
    expect(isInSchedule(WEEKDAYS_9_TO_17, BOGOTA, new Date('2026-07-20T15:00:00Z'))).toBe(true);
  });

  it('start is inclusive, end is exclusive', () => {
    expect(isInSchedule(WEEKDAYS_9_TO_17, BOGOTA, new Date('2026-07-20T14:00:00Z'))).toBe(true); // 09:00
    expect(isInSchedule(WEEKDAYS_9_TO_17, BOGOTA, new Date('2026-07-20T13:59:00Z'))).toBe(false); // 08:59
    expect(isInSchedule(WEEKDAYS_9_TO_17, BOGOTA, new Date('2026-07-20T22:00:00Z'))).toBe(false); // 17:00
    expect(isInSchedule(WEEKDAYS_9_TO_17, BOGOTA, new Date('2026-07-20T21:59:00Z'))).toBe(true); // 16:59
  });

  it('timezone matters: same instant, different answers in Bogota vs UTC', () => {
    // 13:00Z on Monday = 13:00 in UTC (inside) but 08:00 in Bogota (outside).
    const now = new Date('2026-07-20T13:00:00Z');
    expect(isInSchedule(WEEKDAYS_9_TO_17, 'UTC', now)).toBe(true);
    expect(isInSchedule(WEEKDAYS_9_TO_17, BOGOTA, now)).toBe(false);
  });

  it('day-of-week is evaluated in tenant-local time', () => {
    // Sunday 03:00Z = Saturday 22:00 in Bogota — neither day is scheduled.
    expect(isInSchedule(WEEKDAYS_9_TO_17, BOGOTA, new Date('2026-07-19T03:00:00Z'))).toBe(false);
    // Monday 10:00 Bogota is still Monday even though it's 15:00Z.
    expect(isInSchedule(WEEKDAYS_9_TO_17, BOGOTA, new Date('2026-07-20T15:00:00Z'))).toBe(true);
    // Sunday during 9-17 local → not a scheduled day.
    expect(isInSchedule(WEEKDAYS_9_TO_17, BOGOTA, new Date('2026-07-19T16:00:00Z'))).toBe(false);
  });

  it('zero-width range (start === end) is never in schedule', () => {
    const schedule = { days: [0, 1, 2, 3, 4, 5, 6], start: '09:00', end: '09:00' };
    expect(isInSchedule(schedule, BOGOTA, new Date('2026-07-20T15:00:00Z'))).toBe(false);
  });

  it('throws on an invalid IANA timezone', () => {
    expect(() =>
      isInSchedule(WEEKDAYS_9_TO_17, 'America/Bogotá', new Date('2026-07-20T15:00:00Z')),
    ).toThrow();
  });
});

describe('isInSchedule — overnight ranges (start > end)', () => {
  // Monday-only night shift, 22:00 → 06:00: covers Mon 22:00–24:00 + Tue 00:00–06:00.
  const MONDAY_NIGHT = { days: [1], start: '22:00', end: '06:00' };

  it('evening leg on the scheduled day', () => {
    // Mon 23:00 Bogota = Tue 04:00Z
    expect(isInSchedule(MONDAY_NIGHT, BOGOTA, new Date('2026-07-21T04:00:00Z'))).toBe(true);
    // Mon 21:59 Bogota → before start
    expect(isInSchedule(MONDAY_NIGHT, BOGOTA, new Date('2026-07-21T02:59:00Z'))).toBe(false);
  });

  it('morning leg spills into the next day', () => {
    // Tue 05:00 Bogota = Tue 10:00Z
    expect(isInSchedule(MONDAY_NIGHT, BOGOTA, new Date('2026-07-21T10:00:00Z'))).toBe(true);
    // Tue 06:00 Bogota → end is exclusive
    expect(isInSchedule(MONDAY_NIGHT, BOGOTA, new Date('2026-07-21T11:00:00Z'))).toBe(false);
  });

  it('does not fire on unscheduled days', () => {
    // Tue 23:00 Bogota (Tuesday nights are not scheduled)
    expect(isInSchedule(MONDAY_NIGHT, BOGOTA, new Date('2026-07-22T04:00:00Z'))).toBe(false);
    // Mon 05:00 Bogota — morning leg belongs to Sunday's (unscheduled) shift
    expect(isInSchedule(MONDAY_NIGHT, BOGOTA, new Date('2026-07-20T10:00:00Z'))).toBe(false);
  });
});

describe('isAgentActive — the three operating modes', () => {
  const insideBusinessHours = new Date('2026-07-20T15:00:00Z'); // Mon 10:00 Bogota
  const outsideBusinessHours = new Date('2026-07-21T02:00:00Z'); // Mon 21:00 Bogota

  it("'always' is always active", () => {
    const { agent } = makeAgentConfig({ operatingMode: 'always' });
    expect(isAgentActive(agent, BOGOTA, insideBusinessHours)).toBe(true);
    expect(isAgentActive(agent, BOGOTA, outsideBusinessHours)).toBe(true);
  });

  it("'schedule' is active only inside the schedule", () => {
    const { agent } = makeAgentConfig({ operatingMode: 'schedule', schedule: WEEKDAYS_9_TO_17 });
    expect(isAgentActive(agent, BOGOTA, insideBusinessHours)).toBe(true);
    expect(isAgentActive(agent, BOGOTA, outsideBusinessHours)).toBe(false);
  });

  it("'outside_hours' inverts the schedule (bot covers nights/weekends)", () => {
    const { agent } = makeAgentConfig({
      operatingMode: 'outside_hours',
      schedule: WEEKDAYS_9_TO_17,
    });
    expect(isAgentActive(agent, BOGOTA, insideBusinessHours)).toBe(false);
    expect(isAgentActive(agent, BOGOTA, outsideBusinessHours)).toBe(true);
    // Sunday is not a scheduled day → outside hours → bot active.
    expect(isAgentActive(agent, BOGOTA, new Date('2026-07-19T16:00:00Z'))).toBe(true);
  });

  it("'outside_hours' with no schedule defined → always active", () => {
    const { agent } = makeAgentConfig({ operatingMode: 'outside_hours' });
    expect(isAgentActive(agent, BOGOTA, insideBusinessHours)).toBe(true);
  });
});
