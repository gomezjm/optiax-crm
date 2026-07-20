/**
 * Orders reads (WS-D2 §2): applies a query plan to supabase-js. All access is
 * anon-key + session; RLS scopes every query to the tenant.
 *
 * The customer is embedded (PostgREST to-one join) because every row shows it
 * and the search filter needs it; items are fetched in one follow-up query for
 * the whole page rather than one per row.
 */
import type { DashboardSupabaseClient } from '@/lib/supabase/types';
import type { OrderFilterModel } from './filter-model';
import { buildOrderQueryPlan, type PlanFilter } from './query-translation';
import type {
  OrderCustomer,
  OrderItemRow,
  OrderListItem,
  OrderMasters,
  OrderRow,
  OrdersPage,
} from './types';

const CUSTOMER_COLUMNS = 'id, name, phone, wa_id, address, city';

/**
 * The slice of the PostgREST builder a query plan needs. Declared structurally
 * so one `applyFilter` serves both the paged read and the export read; the
 * builder's methods return `this`, which is what `T` binds to.
 */
interface FilterableQuery<T> {
  or(filters: string, options?: { referencedTable?: string }): T;
  is(column: string, value: null): T;
  not(column: string, operator: string, value: null): T;
  filter(column: string, operator: string, value: unknown): T;
}

function applyFilter<T extends FilterableQuery<T>>(query: T, filter: PlanFilter): T {
  switch (filter.method) {
    case 'or':
      return filter.referencedTable
        ? query.or(filter.value, { referencedTable: filter.referencedTable })
        : query.or(filter.value);
    case 'is':
      return query.is(filter.column, filter.value);
    case 'notIs':
      return query.not(filter.column, 'is', filter.value);
    default:
      return query.filter(filter.column, filter.method, filter.value);
  }
}

export async function fetchOrdersPage(
  client: DashboardSupabaseClient,
  model: OrderFilterModel,
): Promise<OrdersPage> {
  const plan = buildOrderQueryPlan(model);

  // `!inner` only when searching: an inner join would otherwise drop nothing
  // (customer_id is NOT NULL) but it does force PostgREST to plan the join.
  const join = plan.needsCustomerJoin ? '!inner' : '';
  let query = client
    .from('orders')
    .select(`*, customers${join}(${CUSTOMER_COLUMNS})`, { count: 'exact' });
  for (const filter of plan.filters) {
    query = applyFilter(query, filter);
  }

  const { data, error, count } = await query
    .order(plan.sort.column, { ascending: plan.sort.ascending, nullsFirst: false })
    .order('id', { ascending: true })
    .range(plan.rangeFrom, plan.rangeTo);
  if (error) throw error;

  const rows = (data ?? []) as unknown as (OrderRow & { customers: OrderCustomer | null })[];
  const itemsByOrder = await fetchItemsFor(
    client,
    rows.map((row) => row.id),
  );

  return {
    items: rows.map(({ customers, ...order }) => ({
      order,
      customer: customers,
      items: itemsByOrder.get(order.id) ?? [],
    })),
    total: count ?? 0,
  };
}

/**
 * Every matching order (capped), for the CSV export — the export covers the
 * whole filtered set, not just the page the user happens to be on (§2).
 */
export async function fetchOrdersForExport(
  client: DashboardSupabaseClient,
  model: OrderFilterModel,
  cap: number,
): Promise<OrderListItem[]> {
  const plan = buildOrderQueryPlan(model);
  const join = plan.needsCustomerJoin ? '!inner' : '';
  let query = client.from('orders').select(`*, customers${join}(${CUSTOMER_COLUMNS})`);
  for (const filter of plan.filters) {
    query = applyFilter(query, filter);
  }

  const { data, error } = await query
    .order(plan.sort.column, { ascending: plan.sort.ascending, nullsFirst: false })
    .order('id', { ascending: true })
    .range(0, cap - 1);
  if (error) throw error;

  const rows = (data ?? []) as unknown as (OrderRow & { customers: OrderCustomer | null })[];
  const itemsByOrder = await fetchItemsFor(
    client,
    rows.map((row) => row.id),
  );
  return rows.map(({ customers, ...order }) => ({
    order,
    customer: customers,
    items: itemsByOrder.get(order.id) ?? [],
  }));
}

/** Items for a set of orders, in insertion order within each order. */
async function fetchItemsFor(
  client: DashboardSupabaseClient,
  orderIds: string[],
): Promise<Map<string, OrderItemRow[]>> {
  const byOrder = new Map<string, OrderItemRow[]>();
  if (orderIds.length === 0) return byOrder;

  const { data, error } = await client
    .from('order_items')
    .select('*')
    .in('order_id', orderIds)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;

  for (const row of data ?? []) {
    const list = byOrder.get(row.order_id) ?? [];
    list.push(row);
    byOrder.set(row.order_id, list);
  }
  return byOrder;
}

/** One order with its customer and items (drawer refresh after a save). */
export async function fetchOrderById(
  client: DashboardSupabaseClient,
  orderId: string,
): Promise<OrderListItem | null> {
  const { data, error } = await client
    .from('orders')
    .select(`*, customers(${CUSTOMER_COLUMNS})`)
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const { customers, ...order } = data as unknown as OrderRow & {
    customers: OrderCustomer | null;
  };
  const itemsByOrder = await fetchItemsFor(client, [order.id]);
  return { order, customer: customers, items: itemsByOrder.get(order.id) ?? [] };
}

/**
 * The tenant's status pipeline and payment methods (§3). D4 owns editing
 * these; D2 only reads them.
 */
export async function fetchOrderMasters(
  client: DashboardSupabaseClient,
): Promise<OrderMasters> {
  const [statuses, paymentMethods] = await Promise.all([
    client.from('order_statuses').select('*').order('sort_order'),
    client.from('payment_methods').select('*').eq('enabled', true).order('label'),
  ]);
  if (statuses.error) throw statuses.error;
  if (paymentMethods.error) throw paymentMethods.error;
  return { statuses: statuses.data, paymentMethods: paymentMethods.data };
}

/** Customer picker for manual order creation (§2). */
export async function searchCustomers(
  client: DashboardSupabaseClient,
  term: string,
  limit = 20,
): Promise<OrderCustomer[]> {
  const cleaned = term.replace(/[,()%_\\"']/g, ' ').trim();
  let query = client.from('customers').select(CUSTOMER_COLUMNS);
  if (cleaned.length > 0) {
    query = query.or(`name.ilike.%${cleaned}%,phone.ilike.%${cleaned}%`);
  }
  const { data, error } = await query.order('name').limit(limit);
  if (error) throw error;
  return data;
}

/** The customer's conversation id (drawer deep link, reusing D1's pattern). */
export async function fetchConversationIdForCustomer(
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
