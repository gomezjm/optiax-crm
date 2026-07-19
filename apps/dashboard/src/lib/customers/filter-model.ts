/**
 * The customers-list filter model (WS-D1 §2): a plain serializable object that
 * round-trips through URL search params so filtered views are shareable.
 * Attribute filters are typed per attribute_def, so parsing needs the tenant's
 * enabled defs.
 */
import type { AttributeDefRow, ConsentStatus, CustomerSource } from './types';

export const PAGE_SIZE = 50;

export const SORT_FIELDS = ['name', 'total_spent', 'last_order_at', 'last_message_at'] as const;
export type SortField = (typeof SORT_FIELDS)[number];

export type AttributeFilter =
  | { key: string; type: 'select'; value: string }
  | { key: string; type: 'boolean'; value: boolean }
  | { key: string; type: 'text'; contains: string }
  | { key: string; type: 'number'; min?: number; max?: number }
  | { key: string; type: 'date'; min?: string; max?: string };

export interface CustomerFilterModel {
  search?: string;
  /** any-of */
  tagIds?: string[];
  consent?: ConsentStatus;
  source?: CustomerSource;
  attributes?: AttributeFilter[];
  totalSpentMin?: number;
  totalSpentMax?: number;
  /** last_order_at older than N days */
  lastOrderOlderThanDays?: number;
  /** last_order_at within the last N days */
  lastOrderNewerThanDays?: number;
  sort?: SortField;
  sortDir?: 'asc' | 'desc';
  /** 1-based */
  page?: number;
}

const CONSENT_VALUES: ConsentStatus[] = ['unknown', 'opted_in', 'opted_out'];
const SOURCE_VALUES: CustomerSource[] = ['agent', 'manual', 'import', 'coexistence_sync'];

function parsePositiveInt(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function parseFiniteNumber(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** ISO date (YYYY-MM-DD) or undefined — attribute date bounds. */
function parseIsoDate(raw: string | null): string | undefined {
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
}

function parseAttributeFilter(
  def: AttributeDefRow,
  params: URLSearchParams,
): AttributeFilter | undefined {
  const base = `attr.${def.key}`;
  switch (def.type) {
    case 'select': {
      const value = params.get(base);
      return value ? { key: def.key, type: 'select', value } : undefined;
    }
    case 'boolean': {
      const value = params.get(base);
      if (value !== 'true' && value !== 'false') return undefined;
      return { key: def.key, type: 'boolean', value: value === 'true' };
    }
    case 'text': {
      const contains = params.get(base);
      return contains ? { key: def.key, type: 'text', contains } : undefined;
    }
    case 'number': {
      const min = parseFiniteNumber(params.get(`${base}.min`));
      const max = parseFiniteNumber(params.get(`${base}.max`));
      if (min === undefined && max === undefined) return undefined;
      return {
        key: def.key,
        type: 'number',
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
      };
    }
    case 'date': {
      const min = parseIsoDate(params.get(`${base}.min`));
      const max = parseIsoDate(params.get(`${base}.max`));
      if (min === undefined && max === undefined) return undefined;
      return {
        key: def.key,
        type: 'date',
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
      };
    }
  }
}

/** URL search params → filter model. Unknown/malformed params are dropped. */
export function parseFilterModel(
  params: URLSearchParams,
  defs: AttributeDefRow[],
): CustomerFilterModel {
  const model: CustomerFilterModel = {};

  const search = params.get('q')?.trim();
  if (search) model.search = search;

  const tagIds = params.get('tags')?.split(',').filter(Boolean);
  if (tagIds && tagIds.length > 0) model.tagIds = tagIds;

  const consent = params.get('consent');
  if (consent && (CONSENT_VALUES as string[]).includes(consent)) {
    model.consent = consent as ConsentStatus;
  }

  const source = params.get('source');
  if (source && (SOURCE_VALUES as string[]).includes(source)) {
    model.source = source as CustomerSource;
  }

  const attributes = defs
    .map((def) => parseAttributeFilter(def, params))
    .filter((f): f is AttributeFilter => f !== undefined);
  if (attributes.length > 0) model.attributes = attributes;

  const spentMin = parseFiniteNumber(params.get('spentMin'));
  if (spentMin !== undefined) model.totalSpentMin = spentMin;
  const spentMax = parseFiniteNumber(params.get('spentMax'));
  if (spentMax !== undefined) model.totalSpentMax = spentMax;

  const orderOlder = parsePositiveInt(params.get('orderOlder'));
  if (orderOlder !== undefined) model.lastOrderOlderThanDays = orderOlder;
  const orderNewer = parsePositiveInt(params.get('orderNewer'));
  if (orderNewer !== undefined) model.lastOrderNewerThanDays = orderNewer;

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

/** Filter model → URL search params (inverse of parseFilterModel). */
export function serializeFilterModel(model: CustomerFilterModel): URLSearchParams {
  const params = new URLSearchParams();
  if (model.search) params.set('q', model.search);
  if (model.tagIds && model.tagIds.length > 0) params.set('tags', model.tagIds.join(','));
  if (model.consent) params.set('consent', model.consent);
  if (model.source) params.set('source', model.source);
  for (const attr of model.attributes ?? []) {
    const base = `attr.${attr.key}`;
    switch (attr.type) {
      case 'select':
        params.set(base, attr.value);
        break;
      case 'boolean':
        params.set(base, String(attr.value));
        break;
      case 'text':
        params.set(base, attr.contains);
        break;
      case 'number':
      case 'date':
        if (attr.min !== undefined) params.set(`${base}.min`, String(attr.min));
        if (attr.max !== undefined) params.set(`${base}.max`, String(attr.max));
        break;
    }
  }
  if (model.totalSpentMin !== undefined) params.set('spentMin', String(model.totalSpentMin));
  if (model.totalSpentMax !== undefined) params.set('spentMax', String(model.totalSpentMax));
  if (model.lastOrderOlderThanDays !== undefined) {
    params.set('orderOlder', String(model.lastOrderOlderThanDays));
  }
  if (model.lastOrderNewerThanDays !== undefined) {
    params.set('orderNewer', String(model.lastOrderNewerThanDays));
  }
  if (model.sort) params.set('sort', model.sort);
  if (model.sortDir) params.set('dir', model.sortDir);
  if (model.page !== undefined && model.page > 1) params.set('page', String(model.page));
  return params;
}

/** True when any filter (not sort/page) is active — drives the empty state copy. */
export function hasActiveFilters(model: CustomerFilterModel): boolean {
  return Boolean(
    model.search ||
      (model.tagIds && model.tagIds.length > 0) ||
      model.consent ||
      model.source ||
      (model.attributes && model.attributes.length > 0) ||
      model.totalSpentMin !== undefined ||
      model.totalSpentMax !== undefined ||
      model.lastOrderOlderThanDays !== undefined ||
      model.lastOrderNewerThanDays !== undefined,
  );
}
