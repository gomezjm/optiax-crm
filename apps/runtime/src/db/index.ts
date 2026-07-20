/**
 * The tenant-scoped repository module — the load-bearing pattern (spec §1).
 *
 * This directory is the ONLY place the service-role client exists. The public
 * surface is `createDb(...)`, which returns:
 *   - `resolveTenantByPhoneNumberId` — the one legitimately tenant-less query
 *   - `createTenantRepo(tenantId)`   — every method hard-scopes `tenant_id`
 *   - `webhookEvents` / `queue`      — system-level stores the webhook route
 *     and worker need (webhook_events has a nullable tenant_id by design;
 *     the pgmq queue is not a tenant table)
 *
 * The raw client never leaves this module. No exceptions.
 */
import { validateAgentConfig, type AgentConfig, type Database, type Json } from '@optiax/shared';
import { shouldRecordStatus } from '../wa/status-rank.js';
import { createServiceClient, type ServiceClient } from './client.js';

type Tables = Database['public']['Tables'];
export type MessageRow = Tables['messages']['Row'];
export type ConversationRow = Tables['conversations']['Row'];
export type PromptVersionRow = Tables['prompt_versions']['Row'];
export type WebhookEventRow = Tables['webhook_events']['Row'];
export type CustomerRow = Tables['customers']['Row'];
export type ProductRow = Tables['products']['Row'];
export type OrderRow = Tables['orders']['Row'];
export type OrderItemRow = Tables['order_items']['Row'];
export type WaStatus = Database['public']['Enums']['e_wa_status'];

/** A catalog row joined to its category name — the agent never sees ids it can't use. */
export interface CatalogProduct extends ProductRow {
  category_name: string | null;
}

/** Search filter for the `check_catalog` tool (ws-r2 §3). */
export interface CatalogSearch {
  query?: string | undefined;
  category?: string | undefined;
  onlyAvailable?: boolean | undefined;
  limit: number;
}

/** The write half of `create_order`, composed by the executor from validated args. */
export interface NewOrder {
  customerId: string;
  conversationId: string;
  statusId: string;
  total: number;
  currency: string;
  deliveryAddress: string | null;
  deliveryDate: string | null;
  driverNotes: string | null;
  /** Ordered as the customer asked for them; index becomes `sort_order`. */
  items: {
    product_id: string | null;
    description: string;
    qty: number;
    unit_price: number;
  }[];
}

/** Insert payloads with tenant_id (and generated columns) stripped — the repo owns tenant scoping. */
export type NewMessage = Omit<Tables['messages']['Insert'], 'tenant_id' | 'id' | 'created_at'>;
export type NewAgentTurn = Omit<Tables['agent_turns']['Insert'], 'tenant_id' | 'id' | 'created_at'>;

export interface TenantContext {
  id: string;
  name: string;
  agentEnabled: boolean;
  activePromptVersionId: string | null;
  /** IANA timezone name (`tenants.timezone`) — operating-hours evaluation. */
  timezone: string;
  /** ISO currency code (`tenants.currency`) — stamped on agent-created orders. */
  currency: string;
}

export interface InsertMessageResult {
  message: MessageRow;
  /** True when the (tenant_id, wa_message_id) row already existed. */
  wasDuplicate: boolean;
}

export interface TenantRepo {
  getOrCreateConversation(waId: string, profileName: string | null): Promise<ConversationRow>;
  getActivePromptVersion(): Promise<PromptVersionRow | null>;
  /**
   * The tenant's published agent_config parsed with AgentConfigSchema.
   * Null when missing or invalid — callers treat that like "no active prompt
   * version" (ws-r1 spec §1).
   */
  getPublishedConfig(): Promise<AgentConfig | null>;
  /** Coexistence pause: set bot_paused + paused_until (ISO, or null = indefinite). */
  setConversationPause(conversationId: string, pausedUntilIso: string | null): Promise<void>;
  /** Lazy re-arm: clear bot_paused and paused_until. */
  clearConversationPause(conversationId: string): Promise<void>;
  insertMessage(input: NewMessage): Promise<InsertMessageResult>;
  /** Last `limit` messages of the conversation, oldest → newest. */
  listRecentMessages(conversationId: string, limit: number): Promise<MessageRow[]>;
  /** True if an outbound message exists in the conversation strictly after `afterIso`. */
  hasOutboundReplyAfter(conversationId: string, afterIso: string): Promise<boolean>;
  insertAgentTurn(input: NewAgentTurn): Promise<void>;
  updateConversationTimestamps(
    conversationId: string,
    patch: { lastMessageAt?: string; lastCustomerMessageAt?: string },
  ): Promise<void>;
  /**
   * Status webhooks: update wa_status if the message exists AND the incoming
   * status outranks the stored one (monotonic guard, ws-r1 spec §5), else no-op.
   */
  updateMessageWaStatus(waMessageId: string, status: WaStatus): Promise<void>;

  // ── Agent tools (ws-r2 §3) ────────────────────────────────────────────────
  // Every one of these is reachable from a model-driven tool call, so every
  // one hard-scopes tenant_id here rather than trusting its caller.

  /** True when the tenant has at least one product — gates catalog tools. */
  hasAnyProduct(): Promise<boolean>;
  /** Catalog search backing `check_catalog`. */
  searchProducts(search: CatalogSearch): Promise<CatalogProduct[]>;
  /**
   * Catalog rows for the ids an order references, so the executor can price
   * lines from the catalog instead of from model-supplied numbers. Ids that do
   * not belong to this tenant simply do not come back.
   */
  getProductsByIds(ids: string[]): Promise<ProductRow[]>;
  /** The customer this conversation belongs to, if it has one. */
  getConversationCustomer(conversationId: string): Promise<CustomerRow | null>;
  /**
   * Apply a capture patch to an existing customer. Merges `attributes` rather
   * than replacing them, and never touches `source` — an imported customer
   * stays imported (ws-r2 §3).
   */
  updateCustomerCapture(
    customerId: string,
    patch: Omit<Tables['customers']['Update'], 'tenant_id' | 'id' | 'source' | 'wa_id'>,
  ): Promise<CustomerRow>;
  /** The tenant's initial order status (`kind = 'new'`), or null if unconfigured. */
  getInitialOrderStatus(): Promise<Tables['order_statuses']['Row'] | null>;
  /** Insert an order and its items in insertion order; items get sort_order 0..n-1. */
  createOrder(input: NewOrder): Promise<{ order: OrderRow; items: OrderItemRow[] }>;
  /** Flag a conversation for the human team (`handoff_to_human`). */
  setConversationNeedsAttention(conversationId: string, needsAttention: boolean): Promise<void>;
}

export interface WebhookEventsStore {
  insert(input: { eventType: string; payload: Json; tenantId: string | null }): Promise<string>;
  get(id: string): Promise<WebhookEventRow | null>;
  markProcessed(id: string): Promise<void>;
  markError(id: string, error: Json): Promise<void>;
}

export interface QueueMessage {
  msgId: number;
  readCt: number;
  message: Json;
}

export interface WaInboundQueue {
  send(payload: { webhook_event_id: string }): Promise<void>;
  read(maxMessages: number, vtSeconds: number): Promise<QueueMessage[]>;
  archive(msgId: number): Promise<void>;
}

export interface RuntimeDb {
  resolveTenantByPhoneNumberId(phoneNumberId: string): Promise<TenantContext | null>;
  createTenantRepo(tenantId: string): TenantRepo;
  webhookEvents: WebhookEventsStore;
  queue: WaInboundQueue;
}

const UNIQUE_VIOLATION = '23505';

/**
 * Split a catalog query into searchable tokens.
 *
 * Single characters are dropped ("talla M" would otherwise make every product
 * containing an "m" a match), as are PostgREST's `or()` delimiters, so a query
 * with a comma or parenthesis cannot restructure the filter expression.
 */
function searchTokens(query: string | undefined): string[] {
  if (!query) return [];
  return [
    ...new Set(
      query
        .replace(/[,()\\]/g, ' ')
        .toLowerCase()
        .split(/\s+/)
        .filter((token) => token.length > 1),
    ),
  ];
}

/** How many query tokens a product's name or description contains. */
function tokenScore(name: string, description: string | null, tokens: string[]): number {
  const haystack = `${name} ${description ?? ''}`.toLowerCase();
  return tokens.reduce((score, token) => (haystack.includes(token) ? score + 1 : score), 0);
}

function createTenantRepoImpl(client: ServiceClient, tenantId: string): TenantRepo {
  return {
    async getOrCreateConversation(waId, profileName) {
      const { data: existing, error: selectError } = await client
        .from('conversations')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('wa_id', waId)
        .maybeSingle();
      if (selectError) throw selectError;
      if (existing) return existing;

      const { data: customer, error: customerSelectError } = await client
        .from('customers')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('wa_id', waId)
        .maybeSingle();
      if (customerSelectError) throw customerSelectError;

      let customerId = customer?.id ?? null;
      if (!customerId) {
        // Provenance is explicit per phase-0 spec §11: the agent created this customer.
        const { data: created, error: customerInsertError } = await client
          .from('customers')
          .insert({
            tenant_id: tenantId,
            wa_id: waId,
            phone: waId,
            name: profileName,
            source: 'agent',
          })
          .select('id')
          .single();
        if (customerInsertError) throw customerInsertError;
        customerId = created.id;
      }

      const { data: conversation, error: insertError } = await client
        .from('conversations')
        .insert({ tenant_id: tenantId, wa_id: waId, customer_id: customerId })
        .select('*')
        .single();
      if (!insertError) return conversation;
      if (insertError.code !== UNIQUE_VIOLATION) throw insertError;

      // Lost a race on unique (tenant_id, wa_id) — fetch the winner.
      const { data: winner, error: retryError } = await client
        .from('conversations')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('wa_id', waId)
        .single();
      if (retryError) throw retryError;
      return winner;
    },

    async getActivePromptVersion() {
      const { data: tenant, error: tenantError } = await client
        .from('tenants')
        .select('active_prompt_version_id')
        .eq('id', tenantId)
        .single();
      if (tenantError) throw tenantError;
      if (!tenant.active_prompt_version_id) return null;

      const { data, error } = await client
        .from('prompt_versions')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('id', tenant.active_prompt_version_id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    async getPublishedConfig() {
      const { data, error } = await client
        .from('agent_configs')
        .select('config')
        .eq('tenant_id', tenantId)
        .eq('status', 'published')
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const result = validateAgentConfig(data.config);
      return result.ok ? result.config : null;
    },

    async setConversationPause(conversationId, pausedUntilIso) {
      const { error } = await client
        .from('conversations')
        .update({ bot_paused: true, paused_until: pausedUntilIso })
        .eq('tenant_id', tenantId)
        .eq('id', conversationId);
      if (error) throw error;
    },

    async clearConversationPause(conversationId) {
      const { error } = await client
        .from('conversations')
        .update({ bot_paused: false, paused_until: null })
        .eq('tenant_id', tenantId)
        .eq('id', conversationId);
      if (error) throw error;
    },

    async insertMessage(input) {
      const { data, error } = await client
        .from('messages')
        .insert({ ...input, tenant_id: tenantId })
        .select('*')
        .single();
      if (!error) return { message: data, wasDuplicate: false };
      if (error.code !== UNIQUE_VIOLATION || !input.wa_message_id) throw error;

      const { data: existing, error: selectError } = await client
        .from('messages')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('wa_message_id', input.wa_message_id)
        .single();
      if (selectError) throw selectError;
      return { message: existing, wasDuplicate: true };
    },

    async listRecentMessages(conversationId, limit) {
      const { data, error } = await client
        .from('messages')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data.reverse();
    },

    async hasOutboundReplyAfter(conversationId, afterIso) {
      const { data, error } = await client
        .from('messages')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('conversation_id', conversationId)
        .eq('direction', 'outbound')
        .gt('created_at', afterIso)
        .limit(1);
      if (error) throw error;
      return data.length > 0;
    },

    async insertAgentTurn(input) {
      const { error } = await client.from('agent_turns').insert({ ...input, tenant_id: tenantId });
      if (error) throw error;
    },

    async updateConversationTimestamps(conversationId, patch) {
      const update: Tables['conversations']['Update'] = {};
      if (patch.lastMessageAt !== undefined) update.last_message_at = patch.lastMessageAt;
      if (patch.lastCustomerMessageAt !== undefined) {
        update.last_customer_message_at = patch.lastCustomerMessageAt;
      }
      if (Object.keys(update).length === 0) return;
      const { error } = await client
        .from('conversations')
        .update(update)
        .eq('tenant_id', tenantId)
        .eq('id', conversationId);
      if (error) throw error;
    },

    async updateMessageWaStatus(waMessageId, status) {
      const { data: existing, error: selectError } = await client
        .from('messages')
        .select('id, wa_status')
        .eq('tenant_id', tenantId)
        .eq('wa_message_id', waMessageId)
        .maybeSingle();
      if (selectError) throw selectError;
      if (!existing || !shouldRecordStatus(existing.wa_status, status)) return;

      const { error } = await client
        .from('messages')
        .update({ wa_status: status })
        .eq('tenant_id', tenantId)
        .eq('id', existing.id);
      if (error) throw error;
    },

    // ── Agent tools (ws-r2 §3) ──────────────────────────────────────────────

    async hasAnyProduct() {
      const { count, error } = await client
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId);
      if (error) throw error;
      return (count ?? 0) > 0;
    },

    async searchProducts(search) {
      let q = client
        .from('products')
        .select('*, product_categories(name)')
        .eq('tenant_id', tenantId);

      if (search.onlyAvailable !== false) q = q.eq('available', true);

      // The model asks the way a customer talks — "blusa de lino Manuela oliva
      // talla M" — so matching the whole phrase against one column finds
      // nothing. Match on tokens instead and rank by how many hit, which keeps
      // a descriptive query from silently returning an empty catalog.
      const tokens = searchTokens(search.query);
      if (tokens.length > 0) {
        q = q.or(
          tokens.flatMap((t) => [`name.ilike.%${t}%`, `description.ilike.%${t}%`]).join(','),
        );
      }

      const { data, error } = await q.order('name');
      if (error) throw error;

      const rows = data.filter((row) => {
        if (!search.category) return true;
        const name = row.product_categories?.name;
        return name?.toLowerCase() === search.category.toLowerCase();
      });

      const ranked =
        tokens.length > 0
          ? rows
              .map((row) => ({ row, score: tokenScore(row.name, row.description, tokens) }))
              // Stable within a score: `.order('name')` already sorted them.
              .sort((a, b) => b.score - a.score)
              .map(({ row }) => row)
          : rows;

      return ranked.slice(0, search.limit).map(({ product_categories, ...product }) => ({
        ...product,
        category_name: product_categories?.name ?? null,
      }));
    },

    async getProductsByIds(ids) {
      if (ids.length === 0) return [];
      const { data, error } = await client
        .from('products')
        .select('*')
        .eq('tenant_id', tenantId)
        .in('id', ids);
      if (error) throw error;
      return data;
    },

    async getConversationCustomer(conversationId) {
      const { data: conversation, error: conversationError } = await client
        .from('conversations')
        .select('customer_id')
        .eq('tenant_id', tenantId)
        .eq('id', conversationId)
        .maybeSingle();
      if (conversationError) throw conversationError;
      if (!conversation?.customer_id) return null;

      const { data, error } = await client
        .from('customers')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('id', conversation.customer_id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    async updateCustomerCapture(customerId, patch) {
      const { data, error } = await client
        .from('customers')
        .update(patch)
        .eq('tenant_id', tenantId)
        .eq('id', customerId)
        .select('*')
        .single();
      if (error) throw error;
      return data;
    },

    async getInitialOrderStatus() {
      const { data, error } = await client
        .from('order_statuses')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('kind', 'new')
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    async createOrder(input) {
      const { data: order, error: orderError } = await client
        .from('orders')
        .insert({
          tenant_id: tenantId,
          customer_id: input.customerId,
          conversation_id: input.conversationId,
          status_id: input.statusId,
          total: input.total,
          currency: input.currency,
          delivery_address: input.deliveryAddress,
          delivery_date: input.deliveryDate,
          driver_notes: input.driverNotes,
          source: 'agent',
        })
        .select('*')
        .single();
      if (orderError) throw orderError;

      const { data: items, error: itemsError } = await client
        .from('order_items')
        .insert(
          input.items.map((item, index) => ({
            tenant_id: tenantId,
            order_id: order.id,
            product_id: item.product_id,
            description: item.description,
            qty: item.qty,
            unit_price: item.unit_price,
            sort_order: index,
          })),
        )
        .select('*');
      if (itemsError) {
        // An order with no lines is worse than no order: it shows up in /orders
        // with a total nobody can explain. Same compensating delete the
        // dashboard composer does.
        await client.from('orders').delete().eq('tenant_id', tenantId).eq('id', order.id);
        throw itemsError;
      }

      return { order, items };
    },

    async setConversationNeedsAttention(conversationId, needsAttention) {
      const { error } = await client
        .from('conversations')
        .update({ needs_attention: needsAttention })
        .eq('tenant_id', tenantId)
        .eq('id', conversationId);
      if (error) throw error;
    },
  };
}

export function createDb(opts: { url: string; serviceRoleKey: string }): RuntimeDb {
  const client = createServiceClient(opts);

  return {
    async resolveTenantByPhoneNumberId(phoneNumberId) {
      const { data, error } = await client
        .from('tenants')
        .select('id, name, agent_enabled, active_prompt_version_id, timezone, currency')
        .eq('wa_phone_number_id', phoneNumberId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        name: data.name,
        agentEnabled: data.agent_enabled,
        activePromptVersionId: data.active_prompt_version_id,
        timezone: data.timezone,
        currency: data.currency,
      };
    },

    createTenantRepo(tenantId) {
      return createTenantRepoImpl(client, tenantId);
    },

    webhookEvents: {
      async insert(input) {
        const { data, error } = await client
          .from('webhook_events')
          .insert({
            event_type: input.eventType,
            payload: input.payload,
            tenant_id: input.tenantId,
          })
          .select('id')
          .single();
        if (error) throw error;
        return data.id;
      },
      async get(id) {
        const { data, error } = await client
          .from('webhook_events')
          .select('*')
          .eq('id', id)
          .maybeSingle();
        if (error) throw error;
        return data;
      },
      async markProcessed(id) {
        const { error } = await client
          .from('webhook_events')
          .update({ processed_at: new Date().toISOString() })
          .eq('id', id);
        if (error) throw error;
      },
      async markError(id, errorPayload) {
        const { error } = await client
          .from('webhook_events')
          .update({ error: errorPayload })
          .eq('id', id);
        if (error) throw error;
      },
    },

    queue: {
      async send(payload) {
        const { error } = await client.rpc('wa_inbound_send', { payload });
        if (error) throw error;
      },
      async read(maxMessages, vtSeconds) {
        const { data, error } = await client.rpc('wa_inbound_read', {
          max_messages: maxMessages,
          vt_seconds: vtSeconds,
        });
        if (error) throw error;
        return data.map((row) => ({ msgId: row.msg_id, readCt: row.read_ct, message: row.message }));
      },
      async archive(msgId) {
        const { error } = await client.rpc('wa_inbound_archive', { queue_msg_id: msgId });
        if (error) throw error;
      },
    },
  };
}
