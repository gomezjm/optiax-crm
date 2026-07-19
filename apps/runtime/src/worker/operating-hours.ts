/**
 * Operating-hours evaluation (ws-r1 spec §4) in the tenant's timezone.
 * Pure `Intl` API — no date library (hard rule). Half-open ranges
 * [start, end): a 07:00–16:00 schedule is active 07:00:00–15:59:59 local.
 *
 * Overnight ranges (`start > end`, e.g. 22:00–06:00) belong to the day the
 * shift *starts*: with days=[1] (Monday) 22:00–06:00, the bot is in-schedule
 * Monday 22:00→24:00 and Tuesday 00:00→06:00.
 */
import type { AgentConfig } from '@optiax/shared';

type AgentBehavior = AgentConfig['agent'];
type Schedule = NonNullable<AgentBehavior['schedule']>;

/** 0 = Sunday … 6 = Saturday, matching ScheduleSchema.days. */
const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Local weekday + minutes-since-midnight of `now` in `timeZone` (IANA name). */
function localParts(now: Date, timeZone: string): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);

  let day = -1;
  let hour = -1;
  let minute = -1;
  for (const part of parts) {
    if (part.type === 'weekday') day = WEEKDAY_INDEX[part.value] ?? -1;
    else if (part.type === 'hour') hour = Number(part.value);
    else if (part.type === 'minute') minute = Number(part.value);
  }
  if (day < 0 || hour < 0 || minute < 0) {
    throw new Error(`could not resolve local time parts for timezone "${timeZone}"`);
  }
  return { day, minutes: hour * 60 + minute };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/** Throws RangeError on an invalid IANA timezone — callers decide the fallback. */
export function isInSchedule(schedule: Schedule, timeZone: string, now: Date): boolean {
  const { day, minutes } = localParts(now, timeZone);
  const start = toMinutes(schedule.start);
  const end = toMinutes(schedule.end);

  if (start === end) return false; // zero-width range: never in schedule
  if (start < end) return schedule.days.includes(day) && minutes >= start && minutes < end;

  // Overnight: evening leg on a scheduled day, morning leg the day after.
  const dayBefore = (day + 6) % 7;
  return (
    (schedule.days.includes(day) && minutes >= start) ||
    (schedule.days.includes(dayBefore) && minutes < end)
  );
}

/**
 * Whether the agent should reply right now under `operatingMode`:
 *  - 'always'        → active.
 *  - 'schedule'      → active only inside the schedule (no schedule — blocked
 *                      by AgentConfigSchema — degrades to inactive).
 *  - 'outside_hours' → active only outside the schedule (owner covers business
 *                      hours). No schedule defined → nothing is "inside", so
 *                      the agent stays active around the clock.
 */
export function isAgentActive(agent: AgentBehavior, timeZone: string, now: Date = new Date()): boolean {
  switch (agent.operatingMode) {
    case 'always':
      return true;
    case 'schedule':
      return agent.schedule ? isInSchedule(agent.schedule, timeZone, now) : false;
    case 'outside_hours':
      return agent.schedule ? !isInSchedule(agent.schedule, timeZone, now) : true;
  }
}
