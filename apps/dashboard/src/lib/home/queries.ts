/**
 * Home snapshot reads (WS-D4 §1). All tenant-scoped through the anon key + RLS —
 * no service key. The counts lean on head-only `count: 'exact'` requests and a
 * small set of status ids resolved once, rather than pulling order rows, per the
 * spec's "prefer aggregates" rule; only "Ventas de hoy" and the short action
 * list pull rows, and both are naturally small (one day / a handful).
 */
import type { StatusKind } from '@/lib/orders/types';
import type { DashboardSupabaseClient } from '@/lib/supabase/types';
import { tenantDayBoundsUtc } from '@/lib/format';

/** Order status kinds that count as "pending" work (§1). */
const PENDING_KINDS: StatusKind[] = ['new', 'awaiting_payment', 'awaiting_verification', 'processing'];

/** One row of the compact "Acción necesaria" list below the cards. */
export interface AttentionConversation {
  id: string;
  customerName: string | null;
  lastMessageAt: string | null;
}
export interface VerificationOrder {
  id: string;
  total: number;
  customerName: string | null;
}

export interface HomeSnapshot {
  /** Sum of today's non-cancelled order totals, in tenant tz (§1). */
  ventasDeHoy: number;
  pedidosPendientes: number;
  /** needs_attention conversations + awaiting_verification orders (§1). */
  accionNecesaria: number;
  /** Campaigns land in Phase 3; the data path is wired, the number is null. */
  campanasActivas: number | null;
  attentionConversations: AttentionConversation[];
  verificationOrders: VerificationOrder[];
  /** Status ids for the cards' deep-links into a pre-filtered /orders (§1). */
  pendingStatusIds: string[];
  awaitingVerificationStatusId: string | null;
}

/** How many rows to show in each compact action list (the cards hold the full count). */
const ACTION_LIST_LIMIT = 5;

type StatusIndex = Map<StatusKind, string>;

/** Resolve the tenant's status pipeline into a kind→id map (7 rows, one query). */
async function loadStatusIndex(client: DashboardSupabaseClient): Promise<StatusIndex> {
  const { data, error } = await client.from('order_statuses').select('id, kind');
  if (error) throw error;
  const index: StatusIndex = new Map();
  for (const row of data ?? []) index.set(row.kind, row.id);
  return index;
}

async function countOrdersByStatus(
  client: DashboardSupabaseClient,
  statusIds: string[],
): Promise<number> {
  if (statusIds.length === 0) return 0;
  const { count, error } = await client
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .in('status_id', statusIds);
  if (error) throw error;
  return count ?? 0;
}

async function ventasDeHoy(
  client: DashboardSupabaseClient,
  cancelledStatusId: string | undefined,
  now: Date,
  timeZone: string,
): Promise<number> {
  const { start, end } = tenantDayBoundsUtc(now, timeZone);
  let query = client
    .from('orders')
    .select('total')
    .gte('created_at', start)
    .lt('created_at', end);
  // Exclude cancelled to match total_spent (D2 §7.F). `neq` on a null id is a
  // no-op, which is fine — a tenant always has a cancelled status from seed.
  if (cancelledStatusId) query = query.neq('status_id', cancelledStatusId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).reduce((sum, row) => sum + row.total, 0);
}

async function attentionConversations(
  client: DashboardSupabaseClient,
): Promise<AttentionConversation[]> {
  const { data, error } = await client
    .from('conversations')
    .select('id, last_message_at, customers(name)')
    .eq('needs_attention', true)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(ACTION_LIST_LIMIT);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    lastMessageAt: row.last_message_at,
    customerName: (row.customers as { name: string | null } | null)?.name ?? null,
  }));
}

async function verificationOrders(
  client: DashboardSupabaseClient,
  awaitingVerificationStatusId: string | undefined,
): Promise<VerificationOrder[]> {
  if (!awaitingVerificationStatusId) return [];
  const { data, error } = await client
    .from('orders')
    .select('id, total, customers(name)')
    .eq('status_id', awaitingVerificationStatusId)
    .order('created_at', { ascending: false })
    .limit(ACTION_LIST_LIMIT);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    total: row.total,
    customerName: (row.customers as { name: string | null } | null)?.name ?? null,
  }));
}

/** Count of needs_attention conversations (head-only). */
async function countNeedsAttention(client: DashboardSupabaseClient): Promise<number> {
  const { count, error } = await client
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('needs_attention', true);
  if (error) throw error;
  return count ?? 0;
}

export async function fetchHomeSnapshot(
  client: DashboardSupabaseClient,
  timeZone: string,
  now: Date = new Date(),
): Promise<HomeSnapshot> {
  const statusIndex = await loadStatusIndex(client);
  const pendingIds = PENDING_KINDS.map((kind) => statusIndex.get(kind)).filter(
    (id): id is string => id !== undefined,
  );
  const awaitingVerificationId = statusIndex.get('awaiting_verification');
  const cancelledId = statusIndex.get('cancelled');

  const [ventas, pendientes, needsAttentionCount, verifyCount, convos, verifyOrders] =
    await Promise.all([
      ventasDeHoy(client, cancelledId, now, timeZone),
      countOrdersByStatus(client, pendingIds),
      countNeedsAttention(client),
      countOrdersByStatus(client, awaitingVerificationId ? [awaitingVerificationId] : []),
      attentionConversations(client),
      verificationOrders(client, awaitingVerificationId),
    ]);

  return {
    ventasDeHoy: ventas,
    pedidosPendientes: pendientes,
    accionNecesaria: needsAttentionCount + verifyCount,
    campanasActivas: null,
    attentionConversations: convos,
    verificationOrders: verifyOrders,
    pendingStatusIds: pendingIds,
    awaitingVerificationStatusId: awaitingVerificationId ?? null,
  };
}
