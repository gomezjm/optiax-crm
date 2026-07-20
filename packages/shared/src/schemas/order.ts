import { z } from 'zod';

/**
 * Order contracts (WS-D2 §2/§3). The dashboard's manual order composer writes
 * through these; R2's `create_order` agent tool reuses `OrderCreateSchema`.
 *
 * `source` is deliberately absent from both shapes: `orders.source` has no
 * column default by ratified decision (phase-0 §11), so every writer states its
 * provenance explicitly at the call site — `manual` here, `agent` in R2.
 * `total` is absent too: it is always the sum of the items (§2, no override).
 */

/** ISO calendar date (`delivery_date` is a `date` column, not a timestamp). */
const isoDateField = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date (YYYY-MM-DD)');

/**
 * One line of an order. `description` is denormalized from the product name at
 * order time per the schema, so a later rename or delete never rewrites
 * history; `product_id` is nullable for exactly that reason.
 */
export const OrderItemInputSchema = z
  .object({
    product_id: z.string().uuid().nullable(),
    description: z.string().trim().min(1).max(300),
    qty: z.number().int().positive().max(9999),
    unit_price: z.number().finite().nonnegative(),
  })
  .strict();
export type OrderItemInput = z.infer<typeof OrderItemInputSchema>;

/** Hard cap on lines in one order — a runaway loop shouldn't insert 10k rows. */
export const ORDER_MAX_ITEMS = 100;

export const OrderCreateSchema = z
  .object({
    customer_id: z.string().uuid(),
    items: z.array(OrderItemInputSchema).min(1).max(ORDER_MAX_ITEMS),
    payment_method_id: z.string().uuid().nullable(),
    payment_reference: z.string().trim().max(120).nullable(),
    delivery_address: z.string().trim().max(300).nullable(),
    delivery_date: isoDateField.nullable(),
    driver_notes: z.string().trim().max(500).nullable(),
  })
  .strict();
export type OrderCreate = z.infer<typeof OrderCreateSchema>;

/**
 * The mutable surface of an existing order, as three sections the detail
 * drawer saves independently (status / payment / logistics). Items are not
 * editable after creation in v1 — see SESSION_NOTES.
 */
const orderMutableShape = {
  status_id: z.string().uuid(),
  payment_method_id: z.string().uuid().nullable(),
  payment_reference: z.string().trim().max(120).nullable(),
  payment_proof_media_path: z.string().trim().max(400).nullable(),
  payment_verified_at: z.string().datetime({ offset: true }).nullable(),
  delivery_address: z.string().trim().max(300).nullable(),
  delivery_date: isoDateField.nullable(),
  driver_notes: z.string().trim().max(500).nullable(),
};

/** Status change: any status → any status, no transition rules in MVP (§3). */
export const OrderStatusUpdateSchema = z
  .object({ status_id: orderMutableShape.status_id })
  .strict();
export type OrderStatusUpdate = z.infer<typeof OrderStatusUpdateSchema>;

export const OrderPaymentUpdateSchema = z
  .object({
    payment_method_id: orderMutableShape.payment_method_id,
    payment_reference: orderMutableShape.payment_reference,
    payment_proof_media_path: orderMutableShape.payment_proof_media_path,
    payment_verified_at: orderMutableShape.payment_verified_at,
  })
  .partial()
  .strict();
export type OrderPaymentUpdate = z.infer<typeof OrderPaymentUpdateSchema>;

export const OrderLogisticsUpdateSchema = z
  .object({
    delivery_address: orderMutableShape.delivery_address,
    delivery_date: orderMutableShape.delivery_date,
    driver_notes: orderMutableShape.driver_notes,
  })
  .partial()
  .strict();
export type OrderLogisticsUpdate = z.infer<typeof OrderLogisticsUpdateSchema>;

/** Any subset of the above — what `updateOrder` accepts. */
export const OrderUpdateSchema = z.object(orderMutableShape).partial().strict();
export type OrderUpdate = z.infer<typeof OrderUpdateSchema>;

/**
 * The order total, always derived: the UI shows it but never lets anyone type
 * it, so a total can't drift from the lines that justify it.
 */
export function computeOrderTotal(items: readonly { qty: number; unit_price: number }[]): number {
  return items.reduce((sum, item) => sum + item.qty * item.unit_price, 0);
}

/**
 * Payment state shown as a chip in the list (§2). Derived rather than stored:
 * there is no payment-state column, and deriving keeps it honest when the
 * agent (R2) writes a proof path directly.
 */
export const PAYMENT_STATES = ['none', 'reference', 'proof_uploaded', 'verified'] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

export function paymentState(order: {
  payment_reference: string | null;
  payment_proof_media_path: string | null;
  payment_verified_at: string | null;
}): PaymentState {
  if (order.payment_verified_at !== null) return 'verified';
  if (order.payment_proof_media_path !== null) return 'proof_uploaded';
  if (order.payment_reference !== null && order.payment_reference !== '') return 'reference';
  return 'none';
}
