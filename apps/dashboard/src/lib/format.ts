/** es-CO display formatting for dates and money (list + drawer). */

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

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : DATE_TIME.format(date);
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
