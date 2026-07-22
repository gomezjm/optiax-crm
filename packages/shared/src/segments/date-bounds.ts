/**
 * Tenant-timezone date math for `older_than_days` / `newer_than_days`, mirroring
 * the dashboard's D4 `format.ts` approach (pure `Intl`, no date library). It
 * lives here — not imported from the dashboard — because the segment engine is
 * shared: the runtime (C2) evaluates the same rules server-side and must compute
 * identical cutoffs.
 *
 * "Older/newer than N days" is anchored to *local calendar day* boundaries, not
 * a rolling `now - N*24h` window: an owner asking for "hasn't ordered in 30
 * days" means 30 calendar days in their timezone, and the answer shouldn't drift
 * by the hour through the day. The cutoff is the start of the local day N days
 * before today.
 */

const isoDateFormatters = new Map<string, Intl.DateTimeFormat>();
function isoDateFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = isoDateFormatters.get(timeZone);
  if (!fmt) {
    // en-CA renders as YYYY-MM-DD.
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    isoDateFormatters.set(timeZone, fmt);
  }
  return fmt;
}

const wallPartsFormatters = new Map<string, Intl.DateTimeFormat>();
function wallPartsFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = wallPartsFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    wallPartsFormatters.set(timeZone, fmt);
  }
  return fmt;
}

/**
 * The UTC instant a given wall-clock time occupies in `timeZone`. Mirrors D4's
 * `zonedWallTimeToUtc`: render the naive-UTC guess into the zone, measure how
 * far its wall clock drifts from the target, correct by that offset. Correct
 * across DST because the offset is taken at the instant in question.
 */
function zonedWallTimeToUtc(
  timeZone: string,
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const parts = wallPartsFormatter(timeZone).formatToParts(new Date(guess));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return new Date(guess - (wall - guess));
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export interface DayCutoff {
  /** Start of the local day (today − days) as a UTC ISO instant — for `timestamptz` columns. */
  instantIso: string;
  /** The same local day as `YYYY-MM-DD` — for lexicographic comparison against jsonb date text. */
  dateIso: string;
}

/**
 * The start of the local calendar day `days` before `now`'s local day, in both
 * an instant form (for real timestamptz columns) and a date-only form (for
 * jsonb `->>` text dates, which compare lexicographically).
 */
export function dayCutoff(now: Date, timeZone: string, days: number): DayCutoff {
  const localToday = isoDateFormatter(timeZone).format(now); // YYYY-MM-DD
  const y = Number(localToday.slice(0, 4));
  const mo = Number(localToday.slice(5, 7));
  const d = Number(localToday.slice(8, 10));
  // Date.UTC normalizes the (d - days) rollover across month/year boundaries.
  const rolled = new Date(Date.UTC(y, mo - 1, d - days));
  const ry = rolled.getUTCFullYear();
  const rmo = rolled.getUTCMonth() + 1;
  const rd = rolled.getUTCDate();
  const instant = zonedWallTimeToUtc(timeZone, ry, rmo, rd, 0, 0, 0);
  return { instantIso: instant.toISOString(), dateIso: `${ry}-${pad2(rmo)}-${pad2(rd)}` };
}
