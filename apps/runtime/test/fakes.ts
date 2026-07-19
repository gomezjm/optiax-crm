/**
 * In-memory RuntimeDb fake for unit tests (no local Supabase needed).
 * Implements exactly the surface the pipeline/worker touch.
 */
import { randomUUID } from 'node:crypto';
import type { Json } from '@optiax/shared';
import type {
  ConversationRow,
  MessageRow,
  NewAgentTurn,
  NewMessage,
  PromptVersionRow,
  QueueMessage,
  RuntimeDb,
  TenantContext,
  WebhookEventRow,
} from '../src/db/index.js';

export interface FakeTenantSeed {
  tenant: TenantContext;
  phoneNumberId: string;
  promptVersion?: Partial<PromptVersionRow> | null;
}

interface StoredAgentTurn extends NewAgentTurn {
  tenant_id: string;
}

export class FakeDb implements RuntimeDb {
  tenants = new Map<string, { tenant: TenantContext; promptVersion: PromptVersionRow | null }>();
  conversations: ConversationRow[] = [];
  messages: MessageRow[] = [];
  agentTurns: StoredAgentTurn[] = [];
  events = new Map<string, WebhookEventRow>();
  queueMessages: QueueMessage[] = [];
  archived: number[] = [];
  private nextMsgId = 1;
  private clock = Date.parse('2026-07-18T12:00:00Z');

  addTenant(seed: FakeTenantSeed): void {
    const promptVersion =
      seed.promptVersion === null
        ? null
        : ({
            id: randomUUID(),
            tenant_id: seed.tenant.id,
            compiled_prompt: 'SYSTEM PROMPT',
            config_snapshot: {},
            compiler_version: '1.0.0',
            vertical: 'generic',
            created_at: this.now(),
            ...seed.promptVersion,
          } as PromptVersionRow);
    this.tenants.set(seed.phoneNumberId, { tenant: seed.tenant, promptVersion });
  }

  addConversation(partial: Partial<ConversationRow> & { tenant_id: string; wa_id: string }): ConversationRow {
    const conversation: ConversationRow = {
      id: randomUUID(),
      created_at: this.now(),
      updated_at: this.now(),
      customer_id: null,
      bot_paused: false,
      paused_until: null,
      last_customer_message_at: null,
      last_message_at: null,
      needs_attention: false,
      ...partial,
    };
    this.conversations.push(conversation);
    return conversation;
  }

  addEvent(payload: Json, tenantId: string | null = null): string {
    const id = randomUUID();
    this.events.set(id, {
      id,
      created_at: this.now(),
      tenant_id: tenantId,
      provider: '360dialog',
      event_type: 'messages',
      payload,
      processed_at: null,
      error: null,
    });
    return id;
  }

  enqueue(message: Json, readCt = 1): number {
    const msgId = this.nextMsgId++;
    this.queueMessages.push({ msgId, readCt, message });
    return msgId;
  }

  private now(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  resolveTenantByPhoneNumberId(phoneNumberId: string): Promise<TenantContext | null> {
    return Promise.resolve(this.tenants.get(phoneNumberId)?.tenant ?? null);
  }

  createTenantRepo(tenantId: string) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- returned object uses method shorthand, so `this` inside it is rebound
    const db = this;
    const entry = [...db.tenants.values()].find((t) => t.tenant.id === tenantId);
    return {
      getOrCreateConversation(waId: string, profileName: string | null) {
        void profileName; // fake ignores profile names
        const existing = db.conversations.find(
          (c) => c.tenant_id === tenantId && c.wa_id === waId,
        );
        if (existing) return Promise.resolve(existing);
        return Promise.resolve(db.addConversation({ tenant_id: tenantId, wa_id: waId }));
      },
      getActivePromptVersion() {
        return Promise.resolve(entry?.promptVersion ?? null);
      },
      insertMessage(input: NewMessage) {
        if (input.wa_message_id) {
          const existing = db.messages.find(
            (m) => m.tenant_id === tenantId && m.wa_message_id === input.wa_message_id,
          );
          if (existing) return Promise.resolve({ message: existing, wasDuplicate: true });
        }
        const message: MessageRow = {
          id: randomUUID(),
          created_at: db.now(),
          tenant_id: tenantId,
          conversation_id: input.conversation_id,
          wa_message_id: input.wa_message_id ?? null,
          direction: input.direction,
          source: input.source,
          type: input.type,
          body: input.body ?? null,
          media_path: input.media_path ?? null,
          template_name: input.template_name ?? null,
          campaign_id: input.campaign_id ?? null,
          wa_status: input.wa_status ?? null,
          error: input.error ?? null,
        };
        db.messages.push(message);
        return Promise.resolve({ message, wasDuplicate: false });
      },
      listRecentMessages(conversationId: string, limit: number) {
        const all = db.messages.filter(
          (m) => m.tenant_id === tenantId && m.conversation_id === conversationId,
        );
        return Promise.resolve(all.slice(-limit));
      },
      hasOutboundReplyAfter(conversationId: string, afterIso: string) {
        return Promise.resolve(
          db.messages.some(
            (m) =>
              m.tenant_id === tenantId &&
              m.conversation_id === conversationId &&
              m.direction === 'outbound' &&
              m.created_at > afterIso,
          ),
        );
      },
      insertAgentTurn(input: NewAgentTurn) {
        db.agentTurns.push({ ...input, tenant_id: tenantId });
        return Promise.resolve();
      },
      updateConversationTimestamps(
        conversationId: string,
        patch: { lastMessageAt?: string; lastCustomerMessageAt?: string },
      ) {
        const conversation = db.conversations.find(
          (c) => c.tenant_id === tenantId && c.id === conversationId,
        );
        if (conversation) {
          if (patch.lastMessageAt !== undefined) conversation.last_message_at = patch.lastMessageAt;
          if (patch.lastCustomerMessageAt !== undefined) {
            conversation.last_customer_message_at = patch.lastCustomerMessageAt;
          }
        }
        return Promise.resolve();
      },
      updateMessageWaStatus(waMessageId: string, status: MessageRow['wa_status'] & string) {
        const message = db.messages.find(
          (m) => m.tenant_id === tenantId && m.wa_message_id === waMessageId,
        );
        if (message) message.wa_status = status;
        return Promise.resolve();
      },
    };
  }

  webhookEvents = {
    insert: (input: { eventType: string; payload: Json; tenantId: string | null }) => {
      const id = this.addEvent(input.payload, input.tenantId);
      const event = this.events.get(id);
      if (event) event.event_type = input.eventType;
      return Promise.resolve(id);
    },
    get: (id: string) => Promise.resolve(this.events.get(id) ?? null),
    markProcessed: (id: string) => {
      const event = this.events.get(id);
      if (event) event.processed_at = this.now();
      return Promise.resolve();
    },
    markError: (id: string, error: Json) => {
      const event = this.events.get(id);
      if (event) event.error = error;
      return Promise.resolve();
    },
  };

  queue = {
    send: (payload: { webhook_event_id: string }) => {
      this.enqueue(payload as unknown as Json);
      return Promise.resolve();
    },
    read: (maxMessages: number, vtSeconds: number) => {
      void vtSeconds; // fake queue has no visibility timeout
      const batch = this.queueMessages.slice(0, maxMessages);
      this.queueMessages = this.queueMessages.slice(batch.length);
      return Promise.resolve(batch);
    },
    archive: (msgId: number) => {
      this.archived.push(msgId);
      return Promise.resolve();
    },
  };
}
