/** es-CO display formatting for dates, money and phones (list + drawer). */
import { normalizeCustomerPhone } from '@optiax/shared';

const RELATIVE = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
const DATE_TIME = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'America/Bogota',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

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
 * Today as YYYY-MM-DD in the business's timezone — what "Entregas de hoy"
 * means to an owner in Medellín at 11pm, which is not what UTC thinks.
 * Hardcoded to America/Bogota like the rest of this module; revisit when a
 * tenant outside Colombia onboards (see SESSION_NOTES).
 */
const BOGOTA_ISO_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function todayIsoDate(now: Date = new Date()): string {
  return BOGOTA_ISO_DATE.format(now);
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : DATE_TIME.format(date);
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
