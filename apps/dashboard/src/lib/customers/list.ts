/**
 * Customers list reads (WS-D1 §2/§7): applies a query plan to supabase-js.
 * All access is anon-key + session; RLS scopes every query to the tenant.
 *
 * Pagination is offset-based via `.range()` — fine at MVP scale (≤ a few
 * thousand customers). Upgrade path: keyset pagination on (sort column, id)
 * once directories grow past that.
 */
import type { DashboardSupabaseClient } from '@/lib/supabase/types';
import type { CustomerFilterModel } from './filter-model';
import { buildCustomerQueryPlan } from './query-translation';
import type { AttributeDefRow, CustomerRow, CustomersPage, TagRow } from './types';

export async function fetchCustomersPage(
  client: DashboardSupabaseClient,
  model: CustomerFilterModel,
  now: Date = new Date(),
): Promise<CustomersPage> {
  const plan = buildCustomerQueryPlan(model, now);

  // The embedded resource only exists when the tag filter needs the join;
  // embedding always would multiply rows server-side for nothing.
  const select = plan.needsTagJoin ? '*, customer_tags!inner(tag_id)' : '*';
  let query = client.from('customers').select(select, { count: 'exact' });

  for (const filter of plan.filters) {
    switch (filter.method) {
      case 'or':
        query = query.or(filter.value);
        break;
      case 'in':
        query = query.in(filter.column, filter.value);
        break;
      default:
        query = query.filter(filter.column, filter.method, filter.value);
    }
  }

  const { data, error, count } = await query
    .order(plan.sort.column, { ascending: plan.sort.ascending, nullsFirst: false })
    .order('id', { ascending: true })
    .range(plan.rangeFrom, plan.rangeTo);
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

/**
 * Ids of every customer matching the filter, capped (mass-edit's "select all
 * matching", WS-D1 §5).
 */
export async function fetchMatchingCustomerIds(
  client: DashboardSupabaseClient,
  model: CustomerFilterModel,
  cap: number,
  now: Date = new Date(),
): Promise<string[]> {
  const plan = buildCustomerQueryPlan(model, now);
  const select = plan.needsTagJoin ? 'id, customer_tags!inner(tag_id)' : 'id';
  let query = client.from('customers').select(select);
  for (const filter of plan.filters) {
    switch (filter.method) {
      case 'or':
        query = query.or(filter.value);
        break;
      case 'in':
        query = query.in(filter.column, filter.value);
        break;
      default:
        query = query.filter(filter.column, filter.method, filter.value);
    }
  }
  const { data, error } = await query.order('id').range(0, cap - 1);
  if (error) throw error;
  return ((data ?? []) as unknown as { id: string }[]).map((row) => row.id);
}

/** Resolve tags for a set of customers (badge rendering). */
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
  for (const list of byCustomer.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  return byCustomer;
}

/** One customer with tags (duplicate-warning link, drawer refresh). */
export async function fetchCustomerById(
  client: DashboardSupabaseClient,
  customerId: string,
): Promise<{ customer: CustomerRow; tags: TagRow[] } | null> {
  const { data, error } = await client
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const tagsByCustomer = await fetchTagsFor(client, [data.id]);
  return { customer: data, tags: tagsByCustomer.get(data.id) ?? [] };
}

/** Tenant's tags, for the filter bar and the drawer's tag picker. */
export async function fetchTags(client: DashboardSupabaseClient): Promise<TagRow[]> {
  const { data, error } = await client.from('tags').select('*').order('name');
  if (error) throw error;
  return data;
}

/** Enabled attribute defs, for filters, drawer inputs and import mapping. */
export async function fetchEnabledAttributeDefs(
  client: DashboardSupabaseClient,
): Promise<AttributeDefRow[]> {
  const { data, error } = await client
    .from('attribute_defs')
    .select('*')
    .eq('enabled', true)
    .order('label');
  if (error) throw error;
  return data;
}

/** The customer's conversation id (for the "Ver conversación" deep link). */
export async function fetchConversationId(
  client: DashboardSupabaseClient,
  customerId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from('conversations')
    .select('id')
    .eq('customer_id', customerId)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}
