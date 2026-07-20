import { z } from 'zod';
import { ORDER_MAX_ITEMS, OrderCreateSchema, OrderItemInputSchema } from './order.js';

/**
 * The model-facing argument shape for `create_order` (WS-R2 §3).
 *
 * Derived from D2's order contracts rather than restated, so the two cannot
 * drift: the executor composes model args with loop context and validates the
 * resulting write with `OrderCreateSchema` **verbatim**. What the model may
 * say is a strict subset of what the DB accepts.
 *
 * Two things are deliberately NOT model arguments:
 *
 *  - `customer_id` — identity, bound from the conversation. A model that could
 *    name the customer could bill someone else's account.
 *  - `unit_price` / `description` — the executor reads both from the live
 *    catalog row. If the model supplied them, a customer could talk the agent
 *    into a price the business never set, and `check_catalog` would stop being
 *    the single source of truth for prices (phase-0 §6).
 *
 * `payment_method_id` and `payment_reference` are omitted too: they are uuids
 * and back-office references the model has no way to know. The team fills them
 * from the dashboard.
 */

/**
 * One requested line. `product_id` is required and non-null here — every
 * agent-created line must trace to a real catalog row, which is what lets the
 * executor price it. (The stored `order_items.product_id` stays nullable for
 * D2's history-preservation reason; that is a property of the table, not of
 * what the agent may ask for.)
 */
export const CreateOrderItemArgsSchema = z
  .object({
    product_id: OrderItemInputSchema.shape.product_id.unwrap(),
    qty: OrderItemInputSchema.shape.qty,
  })
  .strict();
export type CreateOrderItemArgs = z.infer<typeof CreateOrderItemArgsSchema>;

/**
 * Delivery fields keep D2's value types but become optional here. In
 * `OrderCreateSchema` they are nullable-but-required, which is right for the
 * dashboard composer — the form always submits every field, explicitly empty.
 * A model has no such form: it passes what the customer mentioned and nothing
 * else, so requiring an explicit `null` would fail every ordinary call. The
 * executor fills the omitted ones with `null` before the D2 schema sees them.
 *
 * `.omit()` on the source schema means adding a field there surfaces here as a
 * compile-time decision rather than silently going missing.
 */
export const CreateOrderArgsSchema = OrderCreateSchema.omit({
  customer_id: true,
  items: true,
  payment_method_id: true,
  payment_reference: true,
})
  .partial()
  .extend({
    items: z.array(CreateOrderItemArgsSchema).min(1).max(ORDER_MAX_ITEMS),
    /**
     * Set only after the customer has explicitly agreed to the recap. Required
     * to be `true` when the tenant's `orders.confirmBeforeCreate` is on; the
     * declaration says so, and the executor enforces it rather than trusting
     * the description.
     */
    confirmed: z.boolean().optional(),
  })
  .strict();
export type CreateOrderArgs = z.infer<typeof CreateOrderArgsSchema>;
