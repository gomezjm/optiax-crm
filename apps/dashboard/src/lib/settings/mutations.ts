/**
 * Settings writes (WS-D4 §2). Every master is admin-write per the phase-0 role
 * matrix — RLS rejects a rep, so these run through the same anon key + session.
 * Inputs validate against the shared master schemas before touching the DB.
 */
import {
  AttributeDefCreateSchema,
  AttributeDefUpdateSchema,
  OrderStatusRenameSchema,
  OrderStatusReorderSchema,
  PaymentMethodCreateSchema,
  PaymentMethodUpdateSchema,
  type AttributeDefCreate,
  type AttributeDefUpdate,
  type OrderStatusReorder,
  type PaymentMethodCreate,
  type PaymentMethodUpdate,
} from '@optiax/shared';
import type { DashboardSupabaseClient } from '@/lib/supabase/types';
import { canDemoteAdmin, type Role, type TeamMember } from './types';

// ── Attribute defs ───────────────────────────────────────────────────────────

export async function createAttributeDef(
  client: DashboardSupabaseClient,
  tenantId: string,
  input: AttributeDefCreate,
): Promise<void> {
  const parsed = AttributeDefCreateSchema.parse(input);
  const { error } = await client.from('attribute_defs').insert({
    tenant_id: tenantId,
    key: parsed.key,
    label: parsed.label,
    type: parsed.type,
    options: parsed.options,
    enabled: parsed.enabled,
    is_preset: false, // owner-created defs are never presets
  });
  if (error) throw error;
}

export async function updateAttributeDef(
  client: DashboardSupabaseClient,
  id: string,
  input: AttributeDefUpdate,
): Promise<void> {
  const parsed = AttributeDefUpdateSchema.parse(input);
  const { error } = await client
    .from('attribute_defs')
    .update({ label: parsed.label, options: parsed.options, enabled: parsed.enabled })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteAttributeDef(
  client: DashboardSupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await client.from('attribute_defs').delete().eq('id', id);
  if (error) throw error;
}

// ── Order statuses (rename + reorder only) ───────────────────────────────────

export async function renameOrderStatus(
  client: DashboardSupabaseClient,
  id: string,
  name: string,
): Promise<void> {
  const parsed = OrderStatusRenameSchema.parse({ name });
  const { error } = await client.from('order_statuses').update({ name: parsed.name }).eq('id', id);
  if (error) throw error;
}

/**
 * Persist a new ordering. One UPDATE per row (PostgREST has no bulk upsert of
 * distinct values here); the set is 7 rows, so this is cheap and the isolation
 * suite still scopes each write to the tenant.
 */
export async function reorderOrderStatuses(
  client: DashboardSupabaseClient,
  order: OrderStatusReorder,
): Promise<void> {
  const parsed = OrderStatusReorderSchema.parse(order);
  for (const row of parsed) {
    const { error } = await client
      .from('order_statuses')
      .update({ sort_order: row.sort_order })
      .eq('id', row.id);
    if (error) throw error;
  }
}

// ── Payment methods ──────────────────────────────────────────────────────────

export async function createPaymentMethod(
  client: DashboardSupabaseClient,
  tenantId: string,
  input: PaymentMethodCreate,
): Promise<void> {
  const parsed = PaymentMethodCreateSchema.parse(input);
  const { error } = await client.from('payment_methods').insert({
    tenant_id: tenantId,
    label: parsed.label,
    details: parsed.details,
    enabled: parsed.enabled,
  });
  if (error) throw error;
}

export async function updatePaymentMethod(
  client: DashboardSupabaseClient,
  id: string,
  input: PaymentMethodUpdate,
): Promise<void> {
  const parsed = PaymentMethodUpdateSchema.parse(input);
  // Build key by key: `exactOptionalPropertyTypes` makes an explicit `undefined`
  // distinct from an absent key, and PostgREST would serialize the former.
  const columns: { label?: string; details?: string; enabled?: boolean } = {};
  if (parsed.label !== undefined) columns.label = parsed.label;
  if (parsed.details !== undefined) columns.details = parsed.details;
  if (parsed.enabled !== undefined) columns.enabled = parsed.enabled;
  const { error } = await client.from('payment_methods').update(columns).eq('id', id);
  if (error) throw error;
}

export async function deletePaymentMethod(
  client: DashboardSupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await client.from('payment_methods').delete().eq('id', id);
  if (error) throw error;
}

// ── Team roles ───────────────────────────────────────────────────────────────

export class LastAdminError extends Error {
  constructor() {
    super('cannot demote the last admin');
    this.name = 'LastAdminError';
  }
}

/**
 * Change a member's role. Refuses to demote the last admin (guarded here as
 * well as in the UI, since the UI's `team` snapshot can go stale between load
 * and click).
 */
export async function updateMemberRole(
  client: DashboardSupabaseClient,
  team: TeamMember[],
  profileId: string,
  role: Role,
): Promise<void> {
  if (role === 'sales_rep' && !canDemoteAdmin(team, profileId)) throw new LastAdminError();
  const { error } = await client.from('profiles').update({ role }).eq('id', profileId);
  if (error) throw error;
}
