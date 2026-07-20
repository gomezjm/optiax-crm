/**
 * "2× Camisa M, 1× Collar Wayuu" — the items summary the list cell and the CSV
 * export both show. Pure and shared so the run sheet a driver reads matches
 * the row the owner clicked.
 */
import type { OrderItemRow } from './types';

export function formatItemsSummary(items: readonly Pick<OrderItemRow, 'qty' | 'description'>[]) {
  return items.map((item) => `${item.qty}× ${item.description}`).join(', ');
}

export interface TruncatedSummary {
  text: string;
  /** Items not shown — the cell renders "y N más". */
  remaining: number;
}

/** The list cell shows the first few lines; the drawer shows them all. */
export function truncateItemsSummary(
  items: readonly Pick<OrderItemRow, 'qty' | 'description'>[],
  maxItems = 2,
): TruncatedSummary {
  return {
    text: formatItemsSummary(items.slice(0, maxItems)),
    remaining: Math.max(0, items.length - maxItems),
  };
}
