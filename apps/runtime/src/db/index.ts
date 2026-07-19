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
import type { Database, Json } from '@optiax/shared';
import { createServiceClient, type ServiceClient } from './client.js';

type Tables = Database['public']['Tables'];
export type MessageRow = Tables['messages']['Row'];
export type ConversationRow = Tables['conversations']['Row'];
export type PromptVersionRow = Tables['prompt_versions']['Row'];
export type WebhookEventRow = Tables['webhook_events']['Row'];
export type WaStatus = Database['public']['Enums']['e_wa_status'];

/** Insert payloads with tenant_id (and generated columns) stripped — the repo owns tenant scoping. */
export type NewMessage = Omit<Tables['messages']['Insert'], 'tenant_id' | 'id' | 'created_at'>;
export type NewAgentTurn = Omit<Tables['agent_turns']['Insert'], 'tenant_id' | 'id' | 'created_at'>;

export interface TenantContext {
  id: string;
  name: string;
  agentEnabled: boolean;
  activePromptVersionId: string | null;
}

export interface InsertMessageResult {
  message: MessageRow;
  /** True when the (tenant_id, wa_message_id) row already existed. */
  wasDuplicate: boolean;
}

export interface TenantRepo {
  getOrCreateConversation(waId: string, profileName: string | null): Promise<ConversationRow>;
  getActivePromptVersion(): Promise<PromptVersionRow | null>;
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
  /** Status webhooks: update wa_status if the message exists, else no-op. */
  updateMessageWaStatus(waMessageId: string, status: WaStatus): Promise<void>;
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
      const { error } = await client
        .from('messages')
        .update({ wa_status: status })
        .eq('tenant_id', tenantId)
        .eq('wa_message_id', waMessageId);
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
        .select('id, name, agent_enabled, active_prompt_version_id')
        .eq('wa_phone_number_id', phoneNumberId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        name: data.name,
        agentEnabled: data.agent_enabled,
        activePromptVersionId: data.active_prompt_version_id,
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
