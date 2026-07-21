/** es-CO display formatting for dates, money and phones (list + drawer). */
import { normalizeCustomerPhone } from '@optiax/shared';

/**
 * The tenant's timezone (`tenants.timezone`) threads through the "today" math
 * and timestamp display (WS-D4 §3): what "hoy" means to an owner in Medellín at
 * 11pm is not what UTC thinks. Both seed tenants are Colombian, so this is the
 * default when a caller has no tenant tz to hand, matching the runtime's own
 * fallback — but Home and the orders screen pass the real one.
 */
export const DEFAULT_TIME_ZONE = 'America/Bogota';

const RELATIVE = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

// Intl.DateTimeFormat construction is not free; cache one formatter per tz.
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();
function dateTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = dateTimeFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('es-CO', {
      timeZone,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    dateTimeFormatters.set(timeZone, fmt);
  }
  return fmt;
}

const isoDateFormatters = new Map<string, Intl.DateTimeFormat>();
function isoDateFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = isoDateFormatters.get(timeZone);
  if (!fmt) {
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

/** "hace 2 días" / "hace 3 h" style relative timestamp; '—' when null. */
export function formatRelative(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '—';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '—';
  const seconds = Math.round((then.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return RELATIVE.format(Math.trunc(seconds / 1), 'second');
  if (abs < 3600) return RELATIVE.format(Math.trunc(seconds / 60), 'minute');
  if (abs < 86400) return RELATIVE.format(Math.trunc(seconds / 3600), 'hour');
  if (abs < 86400 * 30) return RELATIVE.format(Math.trunc(seconds / 86400), 'day');
  if (abs < 86400 * 365) return RELATIVE.format(Math.trunc(seconds / (86400 * 30)), 'month');
  return RELATIVE.format(Math.trunc(seconds / (86400 * 365)), 'year');
}

/**
 * A `date` column (YYYY-MM-DD), formatted without ever touching a timezone.
 * `new Date('2026-07-22')` is UTC midnight, which renders as the 21st in
 * Bogotá — so delivery dates are parsed by hand and formatted in UTC.
 */
const DATE_ONLY = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'UTC',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

export function formatDateOnly(value: string | null): string {
  if (!value) return '—';
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parts) return '—';
  const [, year, month, day] = parts;
  return DATE_ONLY.format(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))));
}

/**
 * Today as YYYY-MM-DD in the business's timezone — what "Entregas de hoy" and
 * "Ventas de hoy" mean to an owner in Medellín at 11pm, which is not what UTC
 * thinks. Callers with a tenant tz pass it; the rest get the Colombian default.
 */
export function todayIsoDate(now: Date = new Date(), timeZone: string = DEFAULT_TIME_ZONE): string {
  return isoDateFormatter(timeZone).format(now);
}

export function formatDateTime(iso: string | null, timeZone: string = DEFAULT_TIME_ZONE): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormatter(timeZone).format(date);
}

const WALL_PARTS = new Map<string, Intl.DateTimeFormat>();
function wallPartsFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = WALL_PARTS.get(timeZone);
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
    WALL_PARTS.set(timeZone, fmt);
  }
  return fmt;
}

/**
 * The UTC instant a given wall-clock time occupies in `timeZone`. Mirrors the
 * runtime's `Intl.formatToParts` approach (no date lib): render the naive-UTC
 * guess into the zone, measure how far its wall clock drifts from the target,
 * and correct by that offset. Correct across DST because the offset is taken at
 * the instant in question.
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
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return new Date(guess - (wall - guess));
}

/**
 * The [start, end) UTC bounds of "today" in the tenant's timezone (WS-D4 §1/§3):
 * the half-open range a `created_at >= start && created_at < end` filter uses so
 * "Ventas de hoy" counts an 11pm-Medellín order on the owner's today, not UTC's
 * tomorrow. `end` is the next local midnight, so DST-length days stay correct.
 */
export function tenantDayBoundsUtc(
  now: Date = new Date(),
  timeZone: string = DEFAULT_TIME_ZONE,
): { start: string; end: string } {
  const iso = isoDateFormatter(timeZone).format(now); // en-CA → YYYY-MM-DD
  const y = Number(iso.slice(0, 4));
  const mo = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  const start = zonedWallTimeToUtc(timeZone, y, mo, d, 0, 0, 0);
  // Next calendar day at local midnight; Date.UTC normalizes month/year rollover.
  const end = zonedWallTimeToUtc(timeZone, y, mo, d + 1, 0, 0, 0);
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * Display form for a stored phone. Phones persist as bare digits (D1 §10.1);
 * Colombian mobiles (57 + 10 digits) and bare local 10-digit numbers get the
 * grouping owners recognize, anything else falls back to `+digits` so no
 * unexpected shape is ever mangled.
 */
export function formatPhone(raw: string | null): string {
  if (!raw) return '—';
  const digits = normalizeCustomerPhone(raw);
  if (digits.length === 0) return '—';
  const co = /^57(\d{3})(\d{3})(\d{4})$/.exec(digits);
  if (co) return `+57 ${co[1]} ${co[2]} ${co[3]}`;
  const local = /^(\d{3})(\d{3})(\d{4})$/.exec(digits);
  if (local) return `${local[1]} ${local[2]} ${local[3]}`;
  return `+${digits}`;
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}
