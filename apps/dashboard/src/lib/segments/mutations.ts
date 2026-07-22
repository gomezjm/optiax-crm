/**
 * Segment writes (ws-c1 §2/§4). Segments are operational (rep-writable) — RLS
 * scopes writes to the tenant but does NOT distinguish `is_template` rows, so
 * "templates are admin-only to edit" is enforced in the app layer (the UI hides
 * the controls; the page gates by role). Documented gap, per the spec.
 *
 * Rules are validated against `SegmentRulesSchema` here before any write, so a
 * malformed rule can never reach the column.
 */
import { SegmentRulesSchema, type Json, type SegmentRules } from '@optiax/shared';
import type { DashboardSupabaseClient } from '@/lib/supabase/types';
import type { SegmentRow } from './types';

function rulesToJson(rules: SegmentRules): Json {
  // Validate then widen to the column's jsonb type.
  return SegmentRulesSchema.parse(rules) as unknown as Json;
}

export interface SegmentDraft {
  name: string;
  rules: SegmentRules;
}

/** Create a tenant segment (never a template — templates are seeded). */
export async function createSegment(
  client: DashboardSupabaseClient,
  tenantId: string,
  draft: SegmentDraft,
): Promise<SegmentRow> {
  const { data, error } = await client
    .from('segments')
    .insert({
      tenant_id: tenantId,
      name: draft.name.trim(),
      rules: rulesToJson(draft.rules),
      is_template: false,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/** Update a segment's name/rules. `is_template` is never changed here. */
export async function updateSegment(
  client: DashboardSupabaseClient,
  id: string,
  draft: SegmentDraft,
): Promise<SegmentRow> {
  const { data, error } = await client
    .from('segments')
    .update({ name: draft.name.trim(), rules: rulesToJson(draft.rules) })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/**
 * Delete a segment.
 * C2: guard against deleting a segment a campaign references (campaigns don't
 * exist yet, so there's nothing to check here — leave the hook).
 */
export async function deleteSegment(client: DashboardSupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('segments').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Clone a segment (typically a template) into a new editable tenant segment.
 * The clone is never a template, and gets a distinct name so the two coexist.
 */
export async function cloneSegment(
  client: DashboardSupabaseClient,
  tenantId: string,
  source: SegmentRow,
  cloneName: string,
): Promise<SegmentRow> {
  const rules = SegmentRulesSchema.parse(source.rules);
  return createSegment(client, tenantId, { name: cloneName, rules });
}
