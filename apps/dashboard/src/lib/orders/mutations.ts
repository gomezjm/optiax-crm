/**
 * Order writes (WS-D2 §2/§3). Every insert states `source` explicitly —
 * `orders.source` has no column default by ratified decision — and this module
 * only ever writes `manual`; R2's agent path writes `agent`.
 */
import {
  OrderCreateSchema,
  OrderUpdateSchema,
  computeOrderTotal,
  type OrderCreate,
  type OrderUpdate,
} from '@optiax/shared';
import type { Database } from '@optiax/shared';
import type { DashboardSupabaseClient } from '@/lib/supabase/types';
import type { OrderRow } from './types';

type OrderTableUpdate = Database['public']['Tables']['orders']['Update'];

/** Blank text inputs persist as NULL so the derived payment state stays exact. */
function blankToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export class MissingInitialStatusError extends Error {
  constructor() {
    super('tenant has no order_status with kind = new');
    this.name = 'MissingInitialStatusError';
  }
}

/**
 * Manual order creation (§2).
 *
 * PostgREST gives us no transaction across two tables, so a failed items
 * insert is compensated by deleting the order we just made: an order with no
 * lines and a total of X would be worse than no order at all — it would feed
 * the customer's total_spent through the D2 trigger with nothing to justify it.
 */
export async function createOrder(
  client: DashboardSupabaseClient,
  tenantId: string,
  currency: string,
  input: OrderCreate,
): Promise<OrderRow> {
  const parsed = OrderCreateSchema.parse(input);

  const { data: initialStatus, error: statusError } = await client
    .from('order_statuses')
    .select('id')
    .eq('kind', 'new')
    .maybeSingle();
  if (statusError) throw statusError;
  if (!initialStatus) throw new MissingInitialStatusError();

  const { data: order, error: orderError } = await client
    .from('orders')
    .insert({
      tenant_id: tenantId,
      customer_id: parsed.customer_id,
      status_id: initialStatus.id,
      total: computeOrderTotal(parsed.items),
      currency,
      payment_method_id: parsed.payment_method_id,
      payment_reference: blankToNull(parsed.payment_reference),
      delivery_address: blankToNull(parsed.delivery_address),
      delivery_date: parsed.delivery_date,
      driver_notes: blankToNull(parsed.driver_notes),
      source: 'manual',
    })
    .select()
    .single();
  if (orderError) throw orderError;

  const { error: itemsError } = await client.from('order_items').insert(
    parsed.items.map((item, index) => ({
      tenant_id: tenantId,
      order_id: order.id,
      product_id: item.product_id,
      description: item.description,
      qty: item.qty,
      unit_price: item.unit_price,
      // Persist the composer's row order (R2 Q-A): items render in the order the
      // user entered them, matching the agent-created path (src/db createOrder).
      sort_order: index,
    })),
  );
  if (itemsError) {
    await client.from('orders').delete().eq('id', order.id);
    throw itemsError;
  }

  return order;
}

/** Any subset of the mutable surface — the drawer saves one section at a time. */
export async function updateOrder(
  client: DashboardSupabaseClient,
  orderId: string,
  update: OrderUpdate,
): Promise<OrderRow> {
  const parsed = OrderUpdateSchema.parse(update);

  // Built key by key rather than spread: `exactOptionalPropertyTypes` makes an
  // explicit `undefined` a different thing from an absent key, and PostgREST
  // would serialize the former as a column write.
  const columns: OrderTableUpdate = {};
  if (parsed.status_id !== undefined) columns.status_id = parsed.status_id;
  if (parsed.payment_method_id !== undefined) {
    columns.payment_method_id = parsed.payment_method_id;
  }
  if (parsed.payment_reference !== undefined) {
    columns.payment_reference = blankToNull(parsed.payment_reference);
  }
  if (parsed.payment_proof_media_path !== undefined) {
    columns.payment_proof_media_path = parsed.payment_proof_media_path;
  }
  if (parsed.payment_verified_at !== undefined) {
    columns.payment_verified_at = parsed.payment_verified_at;
  }
  if (parsed.verified_by !== undefined) columns.verified_by = parsed.verified_by;
  if (parsed.delivery_address !== undefined) {
    columns.delivery_address = blankToNull(parsed.delivery_address);
  }
  if (parsed.delivery_date !== undefined) columns.delivery_date = parsed.delivery_date;
  if (parsed.driver_notes !== undefined) columns.driver_notes = blankToNull(parsed.driver_notes);

  const { data, error } = await client
    .from('orders')
    .update(columns)
    .eq('id', orderId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Status change (§3): any status → any status, no transition rules in MVP. */
export async function setOrderStatus(
  client: DashboardSupabaseClient,
  orderId: string,
  statusId: string,
): Promise<OrderRow> {
  return updateOrder(client, orderId, { status_id: statusId });
}

/**
 * "Marcar pago verificado" (§2). Records both *when* and *who* (WS-D4 §0.1):
 * the acting user is read from the current session, so the drawer can show
 * "verificado por {name}". Unverifying clears both columns.
 */
export async function setPaymentVerified(
  client: DashboardSupabaseClient,
  orderId: string,
  verified: boolean,
  now: Date = new Date(),
): Promise<OrderRow> {
  let verifiedBy: string | null = null;
  if (verified) {
    const { data } = await client.auth.getUser();
    verifiedBy = data.user?.id ?? null;
  }
  return updateOrder(client, orderId, {
    payment_verified_at: verified ? now.toISOString() : null,
    verified_by: verifiedBy,
  });
}
