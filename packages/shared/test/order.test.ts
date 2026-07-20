import { describe, expect, it } from 'vitest';
import {
  computeOrderTotal,
  OrderCreateSchema,
  OrderLogisticsUpdateSchema,
  OrderPaymentUpdateSchema,
  OrderStatusUpdateSchema,
  OrderUpdateSchema,
  ORDER_MAX_ITEMS,
  paymentState,
} from '../src/schemas/order.js';

const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333';
const METHOD_ID = '44444444-4444-4444-8444-444444444444';
const STATUS_ID = '55555555-5555-4555-8555-555555555555';

const baseItem = {
  product_id: PRODUCT_ID,
  description: 'Blusa de lino Manuela — talla M',
  qty: 1,
  unit_price: 75000,
};

const baseOrder = {
  customer_id: CUSTOMER_ID,
  items: [baseItem],
  payment_method_id: METHOD_ID,
  payment_reference: 'NEQ-778899',
  delivery_address: 'Cra 43A #18-95, Medellín',
  delivery_date: '2026-07-22',
  driver_notes: 'Dejar en portería',
};

describe('OrderCreateSchema', () => {
  it('accepts a well-formed manual order', () => {
    expect(OrderCreateSchema.parse(baseOrder)).toEqual(baseOrder);
  });

  it('allows every optional field to be null', () => {
    const parsed = OrderCreateSchema.parse({
      customer_id: CUSTOMER_ID,
      items: [baseItem],
      payment_method_id: null,
      payment_reference: null,
      delivery_address: null,
      delivery_date: null,
      driver_notes: null,
    });
    expect(parsed.payment_method_id).toBeNull();
    expect(parsed.delivery_date).toBeNull();
  });

  it('requires at least one item', () => {
    expect(OrderCreateSchema.safeParse({ ...baseOrder, items: [] }).success).toBe(false);
  });

  it(`caps items at ${ORDER_MAX_ITEMS}`, () => {
    const tooMany = Array.from({ length: ORDER_MAX_ITEMS + 1 }, () => baseItem);
    expect(OrderCreateSchema.safeParse({ ...baseOrder, items: tooMany }).success).toBe(false);
  });

  it('rejects a zero or fractional quantity', () => {
    expect(
      OrderCreateSchema.safeParse({ ...baseOrder, items: [{ ...baseItem, qty: 0 }] }).success,
    ).toBe(false);
    expect(
      OrderCreateSchema.safeParse({ ...baseOrder, items: [{ ...baseItem, qty: 1.5 }] }).success,
    ).toBe(false);
  });

  it('rejects a negative unit price', () => {
    expect(
      OrderCreateSchema.safeParse({
        ...baseOrder,
        items: [{ ...baseItem, unit_price: -100 }],
      }).success,
    ).toBe(false);
  });

  it('allows a free-text line with no product (deleted or off-catalog item)', () => {
    const parsed = OrderCreateSchema.parse({
      ...baseOrder,
      items: [{ ...baseItem, product_id: null }],
    });
    expect(parsed.items[0]?.product_id).toBeNull();
  });

  it('requires an ISO delivery date, not a locale one', () => {
    expect(OrderCreateSchema.safeParse({ ...baseOrder, delivery_date: '22/07/2026' }).success).toBe(
      false,
    );
  });

  it('rejects unknown keys — `total` and `source` are never client-supplied', () => {
    expect(OrderCreateSchema.safeParse({ ...baseOrder, total: 999 }).success).toBe(false);
    expect(OrderCreateSchema.safeParse({ ...baseOrder, source: 'manual' }).success).toBe(false);
  });
});

describe('order update schemas', () => {
  it('status update takes exactly a status id', () => {
    expect(OrderStatusUpdateSchema.parse({ status_id: STATUS_ID })).toEqual({
      status_id: STATUS_ID,
    });
    expect(OrderStatusUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('payment update accepts any subset, including clearing verification', () => {
    expect(OrderPaymentUpdateSchema.parse({ payment_verified_at: null })).toEqual({
      payment_verified_at: null,
    });
    expect(
      OrderPaymentUpdateSchema.parse({ payment_verified_at: '2026-07-20T15:04:05.000Z' })
        .payment_verified_at,
    ).toBe('2026-07-20T15:04:05.000Z');
  });

  it('payment update rejects a non-ISO verification timestamp', () => {
    expect(
      OrderPaymentUpdateSchema.safeParse({ payment_verified_at: '2026-07-20' }).success,
    ).toBe(false);
  });

  it('logistics update accepts any subset', () => {
    expect(OrderLogisticsUpdateSchema.parse({ driver_notes: 'Timbre 2' })).toEqual({
      driver_notes: 'Timbre 2',
    });
  });

  it('the combined update accepts fields from all three sections', () => {
    const parsed = OrderUpdateSchema.parse({
      status_id: STATUS_ID,
      payment_reference: 'BC-1',
      delivery_date: '2026-07-25',
    });
    expect(parsed).toEqual({
      status_id: STATUS_ID,
      payment_reference: 'BC-1',
      delivery_date: '2026-07-25',
    });
  });

  it('the combined update rejects columns that are not editable', () => {
    expect(OrderUpdateSchema.safeParse({ total: 1 }).success).toBe(false);
    expect(OrderUpdateSchema.safeParse({ customer_id: CUSTOMER_ID }).success).toBe(false);
  });
});

describe('computeOrderTotal', () => {
  it('sums quantity × unit price across lines', () => {
    expect(
      computeOrderTotal([
        { qty: 2, unit_price: 18000 },
        { qty: 1, unit_price: 9000 },
      ]),
    ).toBe(45000);
  });

  it('is zero for an empty order', () => {
    expect(computeOrderTotal([])).toBe(0);
  });

  it('matches the seeded 15-lunch order (8×18000 + 7×18000)', () => {
    expect(
      computeOrderTotal([
        { qty: 8, unit_price: 18000 },
        { qty: 7, unit_price: 18000 },
      ]),
    ).toBe(270000);
  });
});

describe('paymentState', () => {
  const empty = {
    payment_reference: null,
    payment_proof_media_path: null,
    payment_verified_at: null,
  };

  it('is none when nothing is recorded', () => {
    expect(paymentState(empty)).toBe('none');
  });

  it('is reference when only a reference was typed', () => {
    expect(paymentState({ ...empty, payment_reference: 'NEQ-1' })).toBe('reference');
  });

  it('treats an empty-string reference as no payment', () => {
    expect(paymentState({ ...empty, payment_reference: '' })).toBe('none');
  });

  it('is proof_uploaded once a screenshot exists', () => {
    expect(
      paymentState({ ...empty, payment_reference: 'NEQ-1', payment_proof_media_path: 'a/b.jpg' }),
    ).toBe('proof_uploaded');
  });

  it('verification wins over everything else', () => {
    expect(
      paymentState({
        payment_reference: 'NEQ-1',
        payment_proof_media_path: 'a/b.jpg',
        payment_verified_at: '2026-07-20T00:00:00.000Z',
      }),
    ).toBe('verified');
  });
});
