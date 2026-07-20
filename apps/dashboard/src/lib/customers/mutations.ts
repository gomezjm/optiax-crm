/**
 * Customer writes (WS-D1 §3–§5). Every insert states `source` explicitly —
 * `customers.source` has no default by ratified decision, and this module
 * only ever writes `manual` (the import path writes `import` in import.ts).
 */
import {
  CustomerCreateSchema,
  CustomerEditSchema,
  normalizeCustomerPhone,
  type CustomerCreate,
  type CustomerEdit,
  type Json,
} from '@optiax/shared';
import type { DashboardSupabaseClient } from '@/lib/supabase/types';
import type { CustomerRow, CustomerUpdate, TagRow } from './types';

/** Lightweight identity row used for duplicate checks. */
export interface PhoneIndexEntry {
  id: string;
  name: string | null;
  digits: string;
}

/**
 * Phones are stored as bare digits on every write path (D1 §10.1), but rows
 * predating that rule may still hold formatted text, so duplicate checks
 * normalize client-side anyway: fetch the tenant's (id, name, phone, wa_id) —
 * a few small columns, paged — and index by digit string. Fine at MVP scale;
 * revisit alongside the pagination upgrade.
 */
export async function fetchPhoneIndex(
  client: DashboardSupabaseClient,
): Promise<Map<string, PhoneIndexEntry>> {
  const index = new Map<string, PhoneIndexEntry>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from('customers')
      .select('id, name, phone, wa_id')
      .order('id')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    for (const row of data) {
      for (const raw of [row.phone, row.wa_id]) {
        if (!raw) continue;
        const digits = normalizeCustomerPhone(raw);
        if (digits.length > 0 && !index.has(digits)) {
          index.set(digits, { id: row.id, name: row.name, digits });
        }
      }
    }
    if (data.length < pageSize) return index;
  }
}

/** Match a phone against the index, tolerating a missing country prefix. */
export function findDuplicateByPhone(
  index: Map<string, PhoneIndexEntry>,
  phone: string,
): PhoneIndexEntry | undefined {
  const digits = normalizeCustomerPhone(phone);
  if (digits.length === 0) return undefined;
  const direct = index.get(digits);
  if (direct) return direct;
  // 3015550101 should match a stored 573015550101 and vice versa.
  for (const entry of index.values()) {
    if (entry.digits.endsWith(digits) || digits.endsWith(entry.digits)) return entry;
  }
  return undefined;
}

function editToUpdate(edit: CustomerEdit): CustomerUpdate {
  return {
    name: edit.name,
    // Bare digits on every write path (D1 §10.1) — the import path already did
    // this; manual create/edit now matches. The UI display-formats on read.
    phone: edit.phone === null ? null : normalizeCustomerPhone(edit.phone),
    email: edit.email,
    address: edit.address,
    city: edit.city,
    gender: edit.gender,
    age_group: edit.age_group,
    consent_status: edit.consent_status,
    attributes: edit.attributes as Json,
  };
}

export async function updateCustomer(
  client: DashboardSupabaseClient,
  customerId: string,
  edit: CustomerEdit,
): Promise<CustomerRow> {
  const parsed = CustomerEditSchema.parse(edit);
  const { data, error } = await client
    .from('customers')
    .update(editToUpdate(parsed))
    .eq('id', customerId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export type CreateCustomerResult =
  | { outcome: 'created'; customer: CustomerRow }
  | { outcome: 'duplicate'; existing: PhoneIndexEntry };

/** Manual creation (§4): duplicate phone/wa_id warns instead of creating. */
export async function createCustomer(
  client: DashboardSupabaseClient,
  tenantId: string,
  input: CustomerCreate,
): Promise<CreateCustomerResult> {
  const parsed = CustomerCreateSchema.parse(input);
  const index = await fetchPhoneIndex(client);
  const existing = findDuplicateByPhone(index, parsed.phone);
  if (existing) return { outcome: 'duplicate', existing };

  const { data, error } = await client
    .from('customers')
    .insert({
      tenant_id: tenantId,
      ...editToUpdate(parsed),
      source: 'manual',
    })
    .select()
    .single();
  if (error) throw error;
  return { outcome: 'created', customer: data };
}

export async function addTagToCustomer(
  client: DashboardSupabaseClient,
  tenantId: string,
  customerId: string,
  tagId: string,
): Promise<void> {
  const { error } = await client
    .from('customer_tags')
    .upsert(
      { tenant_id: tenantId, customer_id: customerId, tag_id: tagId },
      { onConflict: 'customer_id,tag_id', ignoreDuplicates: true },
    );
  if (error) throw error;
}

export async function removeTagFromCustomer(
  client: DashboardSupabaseClient,
  customerId: string,
  tagId: string,
): Promise<void> {
  const { error } = await client
    .from('customer_tags')
    .delete()
    .eq('customer_id', customerId)
    .eq('tag_id', tagId);
  if (error) throw error;
}

/** Fixed palette for inline tag creation (§3). */
export const TAG_COLORS = [
  '#f59e0b',
  '#ef4444',
  '#10b981',
  '#3b82f6',
  '#6366f1',
  '#ec4899',
  '#8b5cf6',
  '#64748b',
] as const;

export async function createTag(
  client: DashboardSupabaseClient,
  tenantId: string,
  name: string,
  color: string,
): Promise<TagRow> {
  const { data, error } = await client
    .from('tags')
    .insert({ tenant_id: tenantId, name: name.trim(), color })
    .select()
    .single();
  if (error) throw error;
  return data;
}
