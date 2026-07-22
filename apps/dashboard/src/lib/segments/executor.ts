/**
 * Segment evaluation, dashboard side (ws-c1 §1/§4). The pure translation lives
 * in `@optiax/shared` (`segmentRulesToQuery` → `buildSegmentPostgrestPlan`);
 * this module runs the resulting plan through the anon-key + session client, so
 * RLS scopes every read to the caller's tenant — the engine itself never carries
 * a tenant id. C2's runtime reuses the same shared engine with its own executor.
 *
 * Tag conditions are pre-resolved to member customer-ids here (see the engine's
 * note): PostgREST can't put a joined column inside an `or=()`, but a base-table
 * `id in (…)` composes under both combinators.
 */
import {
  buildSegmentPostgrestPlan,
  referencedTagNames,
  segmentRulesToQuery,
  type SegmentEvalContext,
  type SegmentPostgrestPlan,
  type SegmentRules,
} from '@optiax/shared';
import type { DashboardSupabaseClient } from '@/lib/supabase/types';
import type { CustomerListItem, CustomerRow, TagRow } from '@/lib/customers/types';

/** Rows sampled for the live preview / member list. */
export const SEGMENT_PREVIEW_LIMIT = 50;

/**
 * Resolve tag names to their member customer-ids (RLS-scoped). Every requested
 * name is present in the result — an unknown/empty tag maps to `[]`, which the
 * engine turns into "matches nobody".
 */
export async function resolveTagMembers(
  client: DashboardSupabaseClient,
  tagNames: string[],
): Promise<Record<string, string[]>> {
  const members: Record<string, string[]> = {};
  for (const name of tagNames) members[name] = [];
  if (tagNames.length === 0) return members;

  const { data, error } = await client
    .from('customer_tags')
    .select('customer_id, tags!inner(name)')
    .in('tags.name', tagNames);
  if (error) throw error;

  for (const row of data ?? []) {
    const name = (row.tags as { name: string } | null)?.name;
    if (name && members[name]) members[name].push(row.customer_id);
  }
  return members;
}

/** Translate rules and resolve their tags into an executable PostgREST plan. */
async function buildPlan(
  client: DashboardSupabaseClient,
  rules: SegmentRules,
  ctx: SegmentEvalContext,
): Promise<SegmentPostgrestPlan> {
  const query = segmentRulesToQuery(rules, ctx);
  const tagMembers = await resolveTagMembers(client, referencedTagNames(query));
  return buildSegmentPostgrestPlan(query, { tagMembers });
}

/**
 * A minimal structural view of the supabase-js filter builder — just the
 * methods the plan applies. Declared here (rather than importing the concrete
 * type) so lib/segments stays clear of the Supabase SDK import fence; the real
 * builder satisfies it structurally.
 */
interface PlanApplicable<Q> {
  or(filters: string): Q;
  in(column: string, values: readonly string[]): Q;
  is(column: string, value: null): Q;
  not(column: string, operator: string, value: unknown): Q;
  filter(column: string, operator: string, value: unknown): Q;
}

/** Apply a plan's predicates to a query builder. */
function applyPlan<Q extends PlanApplicable<Q>>(query: Q, plan: SegmentPostgrestPlan): Q {
  if (plan.combinator === 'or') return query.or(plan.expression);
  let q = query;
  for (const f of plan.filters) {
    if (f.method === 'in') {
      q = f.negate ? q.not(f.column, 'in', `(${f.values.join(',')})`) : q.in(f.column, f.values);
    } else if (f.method === 'is-null') {
      q = f.negate ? q.not(f.column, 'is', null) : q.is(f.column, null);
    } else {
      q = q.filter(f.column, f.op, f.value);
    }
  }
  return q;
}

/** Live count of customers matching a segment's rules (head-only). */
export async function evalSegmentCount(
  client: DashboardSupabaseClient,
  rules: SegmentRules,
  ctx: SegmentEvalContext,
): Promise<number> {
  const plan = await buildPlan(client, rules, ctx);
  const base = client.from('customers').select('id', { count: 'exact', head: true });
  const { count, error } = await applyPlan(base, plan);
  if (error) throw error;
  return count ?? 0;
}

/** Resolve tags for a set of customers (badge rendering on the member list). */
async function fetchTagsFor(
  client: DashboardSupabaseClient,
  customerIds: string[],
): Promise<Map<string, TagRow[]>> {
  const byCustomer = new Map<string, TagRow[]>();
  if (customerIds.length === 0) return byCustomer;
  const { data, error } = await client
    .from('customer_tags')
    .select('customer_id, tags(*)')
    .in('customer_id', customerIds);
  if (error) throw error;
  for (const row of data ?? []) {
    if (!row.tags) continue;
    const list = byCustomer.get(row.customer_id) ?? [];
    list.push(row.tags);
    byCustomer.set(row.customer_id, list);
  }
  for (const list of byCustomer.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return byCustomer;
}

/**
 * A page of matching customers plus the total count — for the live preview and
 * the segment member view. Ordered by name (then id) like the customers list.
 */
export async function evalSegmentMembers(
  client: DashboardSupabaseClient,
  rules: SegmentRules,
  ctx: SegmentEvalContext,
  limit: number = SEGMENT_PREVIEW_LIMIT,
): Promise<{ items: CustomerListItem[]; total: number }> {
  const plan = await buildPlan(client, rules, ctx);
  const base = client.from('customers').select('*', { count: 'exact' });
  const {
    data,
    count,
    error,
  } = await applyPlan(base, plan)
    .order('name', { ascending: true, nullsFirst: false })
    .order('id', { ascending: true })
    .range(0, limit - 1);
  if (error) throw error;

  const customers = (data ?? []) as unknown as CustomerRow[];
  const tagsByCustomer = await fetchTagsFor(
    client,
    customers.map((c) => c.id),
  );
  return {
    items: customers.map((customer) => ({
      customer,
      tags: tagsByCustomer.get(customer.id) ?? [],
    })),
    total: count ?? 0,
  };
}
