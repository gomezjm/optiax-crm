/**
 * Segment reads (ws-c1 §2/§4). All tenant-scoped through the anon key + session;
 * RLS does the scoping. Counts and member lists are evaluated live (never
 * materialized) via the shared engine, so they always reflect current data.
 */
import { SegmentRulesSchema, type SegmentEvalContext, type SegmentRules } from '@optiax/shared';
import { DEFAULT_TIME_ZONE } from '@/lib/format';
import type { DashboardSupabaseClient } from '@/lib/supabase/types';
import type { AttributeDefRow } from '@/lib/customers/types';
import { evalSegmentCount, evalSegmentMembers, SEGMENT_PREVIEW_LIMIT } from './executor';
import type { AttributeTypeMap, SegmentListItem, SegmentMembersPage, SegmentRow } from './types';

/** Parse stored rules jsonb; null when it doesn't satisfy the schema. */
export function parseRules(raw: unknown): SegmentRules | null {
  const result = SegmentRulesSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/** Enabled attribute defs as the {key: type} map the engine context needs. */
export function attributeTypeMap(defs: AttributeDefRow[]): AttributeTypeMap {
  const map: AttributeTypeMap = {};
  for (const def of defs) map[def.key] = def.type;
  return map;
}

/** The tenant's timezone, for the engine's date-window math (falls back to CO). */
export async function fetchTenantTimeZone(client: DashboardSupabaseClient): Promise<string> {
  const { data, error } = await client.from('tenants').select('timezone').single();
  if (error) throw error;
  return data?.timezone ?? DEFAULT_TIME_ZONE;
}

/** Assemble the pure engine context from tenant tz + attribute defs. */
export function buildEvalContext(timeZone: string, defs: AttributeDefRow[]): SegmentEvalContext {
  return { timeZone, attributeTypes: attributeTypeMap(defs) };
}

/** All of the tenant's segments (templates first, then by name). */
export async function fetchSegments(client: DashboardSupabaseClient): Promise<SegmentRow[]> {
  const { data, error } = await client
    .from('segments')
    .select('*')
    .order('is_template', { ascending: false })
    .order('name', { ascending: true });
  if (error) throw error;
  return data;
}

/**
 * Segments with a live member count each. Counts run in parallel; a segment
 * whose stored rules no longer parse (e.g. a removed attribute) surfaces with a
 * null count rather than failing the whole list.
 */
export async function fetchSegmentsWithCounts(
  client: DashboardSupabaseClient,
  ctx: SegmentEvalContext,
): Promise<SegmentListItem[]> {
  const segments = await fetchSegments(client);
  return Promise.all(
    segments.map(async (segment) => {
      const rules = parseRules(segment.rules);
      if (!rules) return { segment, rules: null, count: null };
      try {
        const count = await evalSegmentCount(client, rules, ctx);
        return { segment, rules, count };
      } catch {
        return { segment, rules, count: null };
      }
    }),
  );
}

/** One segment by id (detail view). */
export async function fetchSegmentById(
  client: DashboardSupabaseClient,
  id: string,
): Promise<SegmentRow | null> {
  const { data, error } = await client.from('segments').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

/** A page of a segment's live members (the detail view's table). */
export async function fetchSegmentMembers(
  client: DashboardSupabaseClient,
  rules: SegmentRules,
  ctx: SegmentEvalContext,
  limit: number = SEGMENT_PREVIEW_LIMIT,
): Promise<SegmentMembersPage> {
  return evalSegmentMembers(client, rules, ctx, limit);
}
