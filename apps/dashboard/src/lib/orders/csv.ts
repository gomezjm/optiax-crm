/**
 * "Quick Export" (WS-D2 §2) — the moto/Rappi handoff. Exports the *currently
 * filtered* list, not the current page, because the whole point is "give me
 * today's deliveries" as one sheet.
 *
 * Totals are written as plain integers rather than "$ 75.000": the file is
 * opened in Sheets/Excel, where a formatted string stops being a number and
 * the column stops summing.
 */
import Papa from 'papaparse';
import { paymentState } from '@optiax/shared';
import { t } from '@/i18n/index';
import { formatPhone } from '@/lib/format';
import { formatItemsSummary } from './summary';
import type { OrderListItem } from './types';

/** Safety cap; an MVP tenant's whole order history is far below this. */
export const EXPORT_MAX_ROWS = 2000;

/**
 * Header order is the column order — Papa.unparse takes fields from the first
 * object's keys, so the shape here is the shape of the file.
 */
export function buildExportRows(items: readonly OrderListItem[]): Record<string, string>[] {
  return items.map(({ order, customer, items: lines }) => ({
    [t('orders.csv.customer')]: customer?.name ?? '',
    [t('orders.csv.phone')]: formatPhone(customer?.phone ?? customer?.wa_id ?? null),
    [t('orders.csv.address')]: order.delivery_address ?? '',
    [t('orders.csv.deliveryDate')]: order.delivery_date ?? '',
    [t('orders.csv.items')]: formatItemsSummary(lines),
    [t('orders.csv.total')]: String(order.total),
    [t('orders.csv.payment')]: t(`orders.payment.${paymentState(order)}`),
    [t('orders.csv.driverNotes')]: order.driver_notes ?? '',
  }));
}

export function toCsv(rows: readonly Record<string, string>[]): string {
  return Papa.unparse(rows as Record<string, string>[]);
}

export function exportFileName(today: string): string {
  return `pedidos-${today}.csv`;
}

/** UTF-8 BOM — without it Excel opens "María" as "MarÃ­a". */
const BOM = '\uFEFF';

/** Browser-only: hand the file to the user without a server round-trip. */
export function downloadCsv(csv: string, fileName: string): void {
  const blob = new Blob([`${BOM}${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
