/**
 * Orders list filter model (WS-D2 §2) — same URL-round-tripping contract as
 * the customers and products screens, so "Entregas de hoy" is a shareable link
 * and not a hidden mode.
 */
import type { PaymentState } from '@optiax/shared';
import { PAYMENT_STATES } from '@optiax/shared';

export const PAGE_SIZE = 50;

export const SORT_FIELDS = ['created_at', 'delivery_date', 'total'] as const;
export type SortField = (typeof SORT_FIELDS)[number];

export interface OrderFilterModel {
  /** Matches the customer's name or phone. */
  search?: string;
  statusId?: string;
  paymentState?: PaymentState;
  /** ISO dates (YYYY-MM-DD), inclusive on both ends. */
  deliveryFrom?: string;
  deliveryTo?: string;
  createdFrom?: string;
  createdTo?: string;
  sort?: SortField;
  sortDir?: 'asc' | 'desc';
  /** 1-based */
  page?: number;
}

function parsePositiveInt(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function parseIsoDate(raw: string | null): string | undefined {
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
}

/** URL search params → filter model. Unknown/malformed params are dropped. */
export function parseOrderFilterModel(params: URLSearchParams): OrderFilterModel {
  const model: OrderFilterModel = {};

  const search = params.get('q')?.trim();
  if (search) model.search = search;

  const statusId = params.get('status')?.trim();
  if (statusId) model.statusId = statusId;

  const payment = params.get('payment');
  if (payment && (PAYMENT_STATES as readonly string[]).includes(payment)) {
    model.paymentState = payment as PaymentState;
  }

  const deliveryFrom = parseIsoDate(params.get('deliveryFrom'));
  if (deliveryFrom) model.deliveryFrom = deliveryFrom;
  const deliveryTo = parseIsoDate(params.get('deliveryTo'));
  if (deliveryTo) model.deliveryTo = deliveryTo;
  const createdFrom = parseIsoDate(params.get('createdFrom'));
  if (createdFrom) model.createdFrom = createdFrom;
  const createdTo = parseIsoDate(params.get('createdTo'));
  if (createdTo) model.createdTo = createdTo;

  const sort = params.get('sort');
  if (sort && (SORT_FIELDS as readonly string[]).includes(sort)) {
    model.sort = sort as SortField;
  }
  const dir = params.get('dir');
  if (dir === 'asc' || dir === 'desc') model.sortDir = dir;

  const page = parsePositiveInt(params.get('page'));
  if (page !== undefined) model.page = page;

  return model;
}

/** Filter model → URL search params (inverse of parseOrderFilterModel). */
export function serializeOrderFilterModel(model: OrderFilterModel): URLSearchParams {
  const params = new URLSearchParams();
  if (model.search) params.set('q', model.search);
  if (model.statusId) params.set('status', model.statusId);
  if (model.paymentState) params.set('payment', model.paymentState);
  if (model.deliveryFrom) params.set('deliveryFrom', model.deliveryFrom);
  if (model.deliveryTo) params.set('deliveryTo', model.deliveryTo);
  if (model.createdFrom) params.set('createdFrom', model.createdFrom);
  if (model.createdTo) params.set('createdTo', model.createdTo);
  if (model.sort) params.set('sort', model.sort);
  if (model.sortDir) params.set('dir', model.sortDir);
  if (model.page !== undefined && model.page > 1) params.set('page', String(model.page));
  return params;
}

/** True when any filter (not sort/page) is active — drives the empty state copy. */
export function hasActiveOrderFilters(model: OrderFilterModel): boolean {
  return Boolean(
    model.search ||
      model.statusId ||
      model.paymentState ||
      model.deliveryFrom ||
      model.deliveryTo ||
      model.createdFrom ||
      model.createdTo,
  );
}

/**
 * The moto/Rappi handoff shortcut (§2): everything due today, newest first.
 * Deliberately clears the other filters — an owner clicking it wants the
 * whole day's run sheet, not today's deliveries intersected with whatever
 * they were looking at a minute ago.
 */
export function todayDeliveriesModel(today: string): OrderFilterModel {
  return { deliveryFrom: today, deliveryTo: today, sort: 'created_at', sortDir: 'asc' };
}
