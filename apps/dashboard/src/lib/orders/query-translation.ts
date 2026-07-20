/**
 * Pure translation: OrderFilterModel → a PostgREST query plan. No supabase-js
 * here, so every filter — including the derived payment states — is
 * unit-testable; `list.ts` applies the plan to a real query builder.
 */
import type { PaymentState } from '@optiax/shared';
import { PAGE_SIZE, type OrderFilterModel } from './filter-model';

/**
 * Colombia has no DST, so a fixed offset turns a calendar date into the
 * timestamptz bounds an owner means by "creado el 20 de julio". Hardcoded like
 * the rest of the date handling; revisit together (see SESSION_NOTES).
 */
export const TENANT_UTC_OFFSET = '-05:00';

/** One PostgREST filter call. */
export type PlanFilter =
  | { method: 'or'; value: string; referencedTable?: string }
  | { method: 'is' | 'notIs'; column: string; value: null }
  | { method: 'eq' | 'gte' | 'lte' | 'ilike'; column: string; value: string | number | boolean };

export interface OrderQueryPlan {
  /** Inner-join customers (only when the search filter needs it). */
  needsCustomerJoin: boolean;
  filters: PlanFilter[];
  sort: { column: string; ascending: boolean };
  rangeFrom: number;
  rangeTo: number;
}

/** Same rule as the other screens: strip or-syntax and pattern characters. */
export function sanitizeSearchTerm(term: string): string {
  return term.replace(/[,()%_\\"']/g, ' ').trim();
}

export function startOfDay(isoDate: string): string {
  return `${isoDate}T00:00:00.000${TENANT_UTC_OFFSET}`;
}

export function endOfDay(isoDate: string): string {
  return `${isoDate}T23:59:59.999${TENANT_UTC_OFFSET}`;
}

/**
 * Payment state is derived from three nullable columns rather than stored, so
 * filtering has to reconstruct it. Each state is the *exclusive* combination
 * the chip shows, so the four filters partition the table with no overlap.
 */
export function paymentStateFilters(state: PaymentState): PlanFilter[] {
  switch (state) {
    case 'verified':
      return [{ method: 'notIs', column: 'payment_verified_at', value: null }];
    case 'proof_uploaded':
      return [
        { method: 'is', column: 'payment_verified_at', value: null },
        { method: 'notIs', column: 'payment_proof_media_path', value: null },
      ];
    case 'reference':
      return [
        { method: 'is', column: 'payment_verified_at', value: null },
        { method: 'is', column: 'payment_proof_media_path', value: null },
        { method: 'notIs', column: 'payment_reference', value: null },
      ];
    case 'none':
      return [
        { method: 'is', column: 'payment_verified_at', value: null },
        { method: 'is', column: 'payment_proof_media_path', value: null },
        { method: 'is', column: 'payment_reference', value: null },
      ];
  }
}

export function buildOrderQueryPlan(model: OrderFilterModel): OrderQueryPlan {
  const filters: PlanFilter[] = [];

  const term = model.search ? sanitizeSearchTerm(model.search) : '';
  const needsCustomerJoin = term.length > 0;
  if (needsCustomerJoin) {
    // Searched against the embedded customer, not the order: owners look up a
    // delivery by who it's for, never by order id.
    filters.push({
      method: 'or',
      value: `name.ilike.%${term}%,phone.ilike.%${term}%`,
      referencedTable: 'customers',
    });
  }

  if (model.statusId) filters.push({ method: 'eq', column: 'status_id', value: model.statusId });

  if (model.paymentState) filters.push(...paymentStateFilters(model.paymentState));

  // delivery_date is a plain `date` column — compared as-is, no zone maths.
  if (model.deliveryFrom) {
    filters.push({ method: 'gte', column: 'delivery_date', value: model.deliveryFrom });
  }
  if (model.deliveryTo) {
    filters.push({ method: 'lte', column: 'delivery_date', value: model.deliveryTo });
  }

  // created_at is a timestamptz — a calendar date needs explicit day bounds.
  if (model.createdFrom) {
    filters.push({ method: 'gte', column: 'created_at', value: startOfDay(model.createdFrom) });
  }
  if (model.createdTo) {
    filters.push({ method: 'lte', column: 'created_at', value: endOfDay(model.createdTo) });
  }

  const page = model.page ?? 1;
  return {
    needsCustomerJoin,
    filters,
    sort: {
      column: model.sort ?? 'created_at',
      ascending: (model.sortDir ?? 'desc') === 'asc',
    },
    rangeFrom: (page - 1) * PAGE_SIZE,
    rangeTo: page * PAGE_SIZE - 1,
  };
}
