/**
 * Catalog filter model (WS-D2 §1) — same contract as the customers directory:
 * a plain serializable object that round-trips through URL search params, so a
 * filtered catalog view is shareable and the back button behaves.
 */

export const PAGE_SIZE = 50;

export const SORT_FIELDS = ['name', 'price', 'updated_at'] as const;
export type SortField = (typeof SORT_FIELDS)[number];

export const AVAILABILITY_VALUES = ['available', 'unavailable'] as const;
export type Availability = (typeof AVAILABILITY_VALUES)[number];

export interface ProductFilterModel {
  /** Matches the product name. */
  search?: string;
  categoryId?: string;
  availability?: Availability;
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

/** URL search params → filter model. Unknown/malformed params are dropped. */
export function parseProductFilterModel(params: URLSearchParams): ProductFilterModel {
  const model: ProductFilterModel = {};

  const search = params.get('q')?.trim();
  if (search) model.search = search;

  const categoryId = params.get('category')?.trim();
  if (categoryId) model.categoryId = categoryId;

  const availability = params.get('availability');
  if (availability && (AVAILABILITY_VALUES as readonly string[]).includes(availability)) {
    model.availability = availability as Availability;
  }

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

/** Filter model → URL search params (inverse of parseProductFilterModel). */
export function serializeProductFilterModel(model: ProductFilterModel): URLSearchParams {
  const params = new URLSearchParams();
  if (model.search) params.set('q', model.search);
  if (model.categoryId) params.set('category', model.categoryId);
  if (model.availability) params.set('availability', model.availability);
  if (model.sort) params.set('sort', model.sort);
  if (model.sortDir) params.set('dir', model.sortDir);
  if (model.page !== undefined && model.page > 1) params.set('page', String(model.page));
  return params;
}

/** True when any filter (not sort/page) is active — drives the empty state copy. */
export function hasActiveProductFilters(model: ProductFilterModel): boolean {
  return Boolean(model.search || model.categoryId || model.availability);
}
