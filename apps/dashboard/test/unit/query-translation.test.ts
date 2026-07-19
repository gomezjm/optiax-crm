import { describe, expect, it } from 'vitest';
import {
  buildCustomerQueryPlan,
  sanitizeSearchTerm,
} from '../../src/lib/customers/query-translation';
import { PAGE_SIZE } from '../../src/lib/customers/filter-model';

const NOW = new Date('2026-07-19T12:00:00.000Z');

describe('sanitizeSearchTerm', () => {
  it('strips PostgREST or-syntax and pattern characters', () => {
    expect(sanitizeSearchTerm('ana,(rojas)%_"\'\\')).toBe('ana  rojas');
    expect(sanitizeSearchTerm('  camila  ')).toBe('camila');
  });
});

describe('buildCustomerQueryPlan', () => {
  it('defaults: no filters, name asc, first page', () => {
    const plan = buildCustomerQueryPlan({}, NOW);
    expect(plan).toEqual({
      needsTagJoin: false,
      filters: [],
      sort: { column: 'name', ascending: true },
      rangeFrom: 0,
      rangeTo: PAGE_SIZE - 1,
    });
  });

  it('search becomes a three-column or-ilike', () => {
    const plan = buildCustomerQueryPlan({ search: 'cami' }, NOW);
    expect(plan.filters).toEqual([
      { method: 'or', value: 'name.ilike.%cami%,phone.ilike.%cami%,email.ilike.%cami%' },
    ]);
  });

  it('empty search after sanitizing adds no filter', () => {
    expect(buildCustomerQueryPlan({ search: ',,%%' }, NOW).filters).toEqual([]);
  });

  it('tag filter turns on the join and filters the embedded column', () => {
    const plan = buildCustomerQueryPlan({ tagIds: ['t1', 't2'] }, NOW);
    expect(plan.needsTagJoin).toBe(true);
    expect(plan.filters).toEqual([
      { method: 'in', column: 'customer_tags.tag_id', value: ['t1', 't2'] },
    ]);
  });

  it('consent and source are plain eq filters', () => {
    const plan = buildCustomerQueryPlan({ consent: 'opted_out', source: 'agent' }, NOW);
    expect(plan.filters).toEqual([
      { method: 'eq', column: 'consent_status', value: 'opted_out' },
      { method: 'eq', column: 'source', value: 'agent' },
    ]);
  });

  it('select/boolean/text/number/date attribute filters use the right jsonb operator', () => {
    const plan = buildCustomerQueryPlan(
      {
        attributes: [
          { key: 'talla', type: 'select', value: 'M' },
          { key: 'vip', type: 'boolean', value: true },
          { key: 'barrio', type: 'text', contains: 'pobla' },
          { key: 'puntos', type: 'number', min: 5, max: 10 },
          { key: 'cumple', type: 'date', min: '1990-01-01', max: '1999-12-31' },
        ],
      },
      NOW,
    );
    expect(plan.filters).toEqual([
      { method: 'eq', column: 'attributes->>talla', value: 'M' },
      { method: 'eq', column: 'attributes->vip', value: true },
      { method: 'ilike', column: 'attributes->>barrio', value: '%pobla%' },
      { method: 'gte', column: 'attributes->puntos', value: 5 },
      { method: 'lte', column: 'attributes->puntos', value: 10 },
      { method: 'gte', column: 'attributes->>cumple', value: '1990-01-01' },
      { method: 'lte', column: 'attributes->>cumple', value: '1999-12-31' },
    ]);
  });

  it('metric ranges: total_spent bounds and day-based last_order_at cutoffs', () => {
    const plan = buildCustomerQueryPlan(
      {
        totalSpentMin: 1000,
        totalSpentMax: 90000,
        lastOrderOlderThanDays: 30,
        lastOrderNewerThanDays: 7,
      },
      NOW,
    );
    expect(plan.filters).toEqual([
      { method: 'gte', column: 'total_spent', value: 1000 },
      { method: 'lte', column: 'total_spent', value: 90000 },
      { method: 'lte', column: 'last_order_at', value: '2026-06-19T12:00:00.000Z' },
      { method: 'gte', column: 'last_order_at', value: '2026-07-12T12:00:00.000Z' },
    ]);
  });

  it('sort + pagination map to order/range', () => {
    const plan = buildCustomerQueryPlan(
      { sort: 'total_spent', sortDir: 'desc', page: 3 },
      NOW,
    );
    expect(plan.sort).toEqual({ column: 'total_spent', ascending: false });
    expect(plan.rangeFrom).toBe(2 * PAGE_SIZE);
    expect(plan.rangeTo).toBe(3 * PAGE_SIZE - 1);
  });

  it('filters combine', () => {
    const plan = buildCustomerQueryPlan(
      { search: 'a', tagIds: ['t'], consent: 'opted_in', totalSpentMin: 1 },
      NOW,
    );
    expect(plan.filters).toHaveLength(4);
    expect(plan.needsTagJoin).toBe(true);
  });
});
