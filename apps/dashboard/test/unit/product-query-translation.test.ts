import { describe, expect, it } from 'vitest';
import {
  buildProductQueryPlan,
  sanitizeSearchTerm,
} from '../../src/lib/products/query-translation';
import {
  hasActiveProductFilters,
  parseProductFilterModel,
  serializeProductFilterModel,
  PAGE_SIZE,
  type ProductFilterModel,
} from '../../src/lib/products/filter-model';

describe('buildProductQueryPlan', () => {
  it('defaults: no filters, name asc, first page', () => {
    expect(buildProductQueryPlan({})).toEqual({
      filters: [],
      sort: { column: 'name', ascending: true },
      rangeFrom: 0,
      rangeTo: PAGE_SIZE - 1,
    });
  });

  it('search becomes a name-only ilike', () => {
    expect(buildProductQueryPlan({ search: 'blusa' }).filters).toEqual([
      { method: 'ilike', column: 'name', value: '%blusa%' },
    ]);
  });

  it('empty search after sanitizing adds no filter', () => {
    expect(buildProductQueryPlan({ search: ',,%%' }).filters).toEqual([]);
  });

  it('sanitizes PostgREST syntax out of search terms', () => {
    expect(sanitizeSearchTerm('blusa,(lino)%_"\'\\')).toBe('blusa  lino');
  });

  it('availability maps to the boolean column, both directions', () => {
    expect(buildProductQueryPlan({ availability: 'available' }).filters).toEqual([
      { method: 'eq', column: 'available', value: true },
    ]);
    expect(buildProductQueryPlan({ availability: 'unavailable' }).filters).toEqual([
      { method: 'eq', column: 'available', value: false },
    ]);
  });

  it('category filters on the FK column', () => {
    expect(buildProductQueryPlan({ categoryId: 'cat-1' }).filters).toEqual([
      { method: 'eq', column: 'category_id', value: 'cat-1' },
    ]);
  });

  it('combines every filter', () => {
    const plan = buildProductQueryPlan({
      search: 'jean',
      categoryId: 'cat-2',
      availability: 'available',
    });
    expect(plan.filters).toEqual([
      { method: 'ilike', column: 'name', value: '%jean%' },
      { method: 'eq', column: 'category_id', value: 'cat-2' },
      { method: 'eq', column: 'available', value: true },
    ]);
  });

  it('paginates and sorts', () => {
    const plan = buildProductQueryPlan({ sort: 'price', sortDir: 'desc', page: 3 });
    expect(plan.sort).toEqual({ column: 'price', ascending: false });
    expect(plan.rangeFrom).toBe(2 * PAGE_SIZE);
    expect(plan.rangeTo).toBe(3 * PAGE_SIZE - 1);
  });
});

describe('product filter model URL round-trip', () => {
  it('serialize → parse is the identity for a full model', () => {
    const model: ProductFilterModel = {
      search: 'blusa',
      categoryId: 'cat-1',
      availability: 'unavailable',
      sort: 'updated_at',
      sortDir: 'desc',
      page: 4,
    };
    expect(parseProductFilterModel(serializeProductFilterModel(model))).toEqual(model);
  });

  it('drops malformed params instead of failing', () => {
    const params = new URLSearchParams({
      availability: 'maybe',
      sort: 'colour',
      dir: 'sideways',
      page: '-2',
    });
    expect(parseProductFilterModel(params)).toEqual({});
  });

  it('page 1 is not serialized (keeps shared URLs clean)', () => {
    expect(serializeProductFilterModel({ page: 1 }).toString()).toBe('');
  });

  it('hasActiveProductFilters ignores sort and page', () => {
    expect(hasActiveProductFilters({ sort: 'price', page: 2 })).toBe(false);
    expect(hasActiveProductFilters({ availability: 'available' })).toBe(true);
  });
});
