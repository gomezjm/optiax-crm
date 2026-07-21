import { describe, expect, it } from 'vitest';
import {
  buildOrderQueryPlan,
  endOfDay,
  paymentStateFilters,
  startOfDay,
} from '../../src/lib/orders/query-translation';
import {
  hasActiveOrderFilters,
  parseOrderFilterModel,
  serializeOrderFilterModel,
  todayDeliveriesModel,
  PAGE_SIZE,
  type OrderFilterModel,
} from '../../src/lib/orders/filter-model';

describe('buildOrderQueryPlan', () => {
  it('defaults: no filters, newest first, first page', () => {
    expect(buildOrderQueryPlan({})).toEqual({
      needsCustomerJoin: false,
      filters: [],
      sort: { column: 'created_at', ascending: false },
      rangeFrom: 0,
      rangeTo: PAGE_SIZE - 1,
    });
  });

  it('search turns on the customer join and filters the embedded table', () => {
    const plan = buildOrderQueryPlan({ search: 'camila' });
    expect(plan.needsCustomerJoin).toBe(true);
    expect(plan.filters).toEqual([
      {
        method: 'or',
        value: 'name.ilike.%camila%,phone.ilike.%camila%',
        referencedTable: 'customers',
      },
    ]);
  });

  it('a search that sanitizes to nothing does not force the join', () => {
    const plan = buildOrderQueryPlan({ search: '(),%' });
    expect(plan.needsCustomerJoin).toBe(false);
    expect(plan.filters).toEqual([]);
  });

  it('delivery dates compare against the plain date column', () => {
    expect(
      buildOrderQueryPlan({ deliveryFrom: '2026-07-20', deliveryTo: '2026-07-20' }).filters,
    ).toEqual([
      { method: 'gte', column: 'delivery_date', value: '2026-07-20' },
      { method: 'lte', column: 'delivery_date', value: '2026-07-20' },
    ]);
  });

  it('created dates expand to timestamptz day bounds in the tenant offset', () => {
    expect(
      buildOrderQueryPlan({ createdFrom: '2026-07-01', createdTo: '2026-07-31' }).filters,
    ).toEqual([
      { method: 'gte', column: 'created_at', value: '2026-07-01T00:00:00.000-05:00' },
      { method: 'lte', column: 'created_at', value: '2026-07-31T23:59:59.999-05:00' },
    ]);
  });

  it('day bounds cover the whole local day', () => {
    expect(startOfDay('2026-07-20')).toBe('2026-07-20T00:00:00.000-05:00');
    expect(endOfDay('2026-07-20')).toBe('2026-07-20T23:59:59.999-05:00');
  });

  it('sorts and paginates', () => {
    const plan = buildOrderQueryPlan({ sort: 'total', sortDir: 'asc', page: 2 });
    expect(plan.sort).toEqual({ column: 'total', ascending: true });
    expect(plan.rangeFrom).toBe(PAGE_SIZE);
    expect(plan.rangeTo).toBe(2 * PAGE_SIZE - 1);
  });
});

describe('payment state → PostgREST filters', () => {
  it('verified only needs the verification timestamp', () => {
    expect(paymentStateFilters('verified')).toEqual([
      { method: 'notIs', column: 'payment_verified_at', value: null },
    ]);
  });

  it('proof_uploaded excludes already-verified orders', () => {
    expect(paymentStateFilters('proof_uploaded')).toEqual([
      { method: 'is', column: 'payment_verified_at', value: null },
      { method: 'notIs', column: 'payment_proof_media_path', value: null },
    ]);
  });

  it('reference excludes verified and proof-bearing orders', () => {
    expect(paymentStateFilters('reference')).toEqual([
      { method: 'is', column: 'payment_verified_at', value: null },
      { method: 'is', column: 'payment_proof_media_path', value: null },
      { method: 'notIs', column: 'payment_reference', value: null },
    ]);
  });

  it('none requires all three columns empty', () => {
    expect(paymentStateFilters('none')).toEqual([
      { method: 'is', column: 'payment_verified_at', value: null },
      { method: 'is', column: 'payment_proof_media_path', value: null },
      { method: 'is', column: 'payment_reference', value: null },
    ]);
  });

  it('the four states partition the table — no order matches two of them', () => {
    // Every state pins payment_verified_at, and the three unverified states
    // disagree on payment_proof_media_path / payment_reference, so no row can
    // satisfy two filter sets at once.
    const signatures = (['none', 'reference', 'proof_uploaded', 'verified'] as const).map(
      (state) => JSON.stringify(paymentStateFilters(state)),
    );
    expect(new Set(signatures).size).toBe(4);
  });
});

describe('order filter model URL round-trip', () => {
  it('serialize → parse is the identity for a full model', () => {
    const model: OrderFilterModel = {
      search: 'andrés',
      statusId: 'status-1',
      paymentState: 'proof_uploaded',
      deliveryFrom: '2026-07-01',
      deliveryTo: '2026-07-31',
      createdFrom: '2026-06-01',
      createdTo: '2026-06-30',
      sort: 'delivery_date',
      sortDir: 'asc',
      page: 2,
    };
    expect(parseOrderFilterModel(serializeOrderFilterModel(model))).toEqual(model);
  });

  it('drops malformed dates and enum values', () => {
    const params = new URLSearchParams({
      payment: 'partially',
      deliveryFrom: '20-07-2026',
      createdTo: 'ayer',
      sort: 'vibes',
    });
    expect(parseOrderFilterModel(params)).toEqual({});
  });

  it('hasActiveOrderFilters ignores sort and page', () => {
    expect(hasActiveOrderFilters({ sort: 'total', page: 3 })).toBe(false);
    expect(hasActiveOrderFilters({ deliveryFrom: '2026-07-20' })).toBe(true);
  });
});

describe('"Entregas de hoy" shortcut', () => {
  it('pins both delivery bounds to today and clears other filters', () => {
    const model = todayDeliveriesModel('2026-07-20');
    expect(model).toEqual({
      deliveryFrom: '2026-07-20',
      deliveryTo: '2026-07-20',
      sort: 'created_at',
      sortDir: 'asc',
    });
    expect(buildOrderQueryPlan(model).filters).toEqual([
      { method: 'gte', column: 'delivery_date', value: '2026-07-20' },
      { method: 'lte', column: 'delivery_date', value: '2026-07-20' },
    ]);
  });
});

describe('multi-status deep-link (WS-D4 §1)', () => {
  it('round-trips a set of status ids through the `status` param', () => {
    const model: OrderFilterModel = { statusIds: ['s1', 's2', 's3'] };
    const qs = serializeOrderFilterModel(model);
    expect(qs.get('status')).toBe('s1,s2,s3');
    expect(parseOrderFilterModel(new URLSearchParams(qs))).toEqual(model);
  });

  it('a single id parses back as statusId, not statusIds', () => {
    const qs = serializeOrderFilterModel({ statusId: 'only' });
    expect(parseOrderFilterModel(new URLSearchParams(qs))).toEqual({ statusId: 'only' });
  });

  it('builds an `in` filter for statusIds, preferred over statusId', () => {
    const plan = buildOrderQueryPlan({ statusIds: ['a', 'b'], statusId: 'ignored' });
    expect(plan.filters).toEqual([{ method: 'in', column: 'status_id', value: ['a', 'b'] }]);
  });

  it('counts a multi-status filter as active', () => {
    expect(hasActiveOrderFilters({ statusIds: ['a', 'b'] })).toBe(true);
    expect(hasActiveOrderFilters({ statusIds: [] })).toBe(false);
  });
});
