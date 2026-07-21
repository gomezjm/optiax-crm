/**
 * In-memory RuntimeDb fake for unit tests (no local Supabase needed).
 * Implements exactly the surface the pipeline/worker touch.
 */
import { randomUUID } from 'node:crypto';
import { validateAgentConfig, type AgentConfig, type Json } from '@optiax/shared';
import type {
  CatalogSearch,
  ConversationRow,
  CustomerRow,
  MessageRow,
  NewAgentTurn,
  NewMessage,
  NewOrder,
  OrderItemRow,
  OrderRow,
  ProductRow,
  PromptVersionRow,
  QueueMessage,
  RuntimeDb,
  TenantContext,
  WebhookEventRow,
} from '../src/db/index.js';
import { shouldRecordStatus } from '../src/wa/status-rank.js';

export interface FakeTenantSeed {
  tenant: TenantContext;
  phoneNumberId: string;
  promptVersion?: Partial<PromptVersionRow> | null;
  /** Published agent_config; defaults to a minimal valid config. Null = none published. */
  config?: AgentConfig | null;
  /** Draft agent_config for R3 publish-gate tests. Null/omitted = no draft. */
  draftConfig?: AgentConfig | null;
}

/** Everything outside `agent` a tool test may need to vary (ws-r2). */
export interface AgentConfigOverrides {
  catalog?: Partial<AgentConfig['catalog']>;
  orders?: Partial<AgentConfig['orders']>;
  capture?: AgentConfig['capture'];
  escalation?: Partial<AgentConfig['escalation']>;
  guardrails?: AgentConfig['guardrails'];
}

/** Minimal valid AgentConfig for unit tests; override per-test as needed. */
export function makeAgentConfig(
  agent: Partial<AgentConfig['agent']> = {},
  rest: AgentConfigOverrides = {},
): AgentConfig {
  const result = validateAgentConfig({
    version: 1,
    business: { name: 'Moda Valentina', description: 'Boutique de ropa.', vertical: 'retail' },
    agent: {
      displayName: 'Vale',
      tone: 'cercano',
      language: 'es',
      emojiUsage: 'light',
      audioPolicy: 'transcribe',
      operatingMode: 'always',
      pauseHoursOnOwnerReply: 24,
      ...agent,
    },
    catalog: {
      canQuotePrices: true,
      offerPromos: false,
      outOfStock: 'say_unavailable',
      ...rest.catalog,
    },
    orders: {
      enabled: false,
      confirmBeforeCreate: true,
      collectDelivery: false,
      sharePaymentMethods: false,
      ...rest.orders,
    },
    ...(rest.capture ? { capture: rest.capture } : {}),
    ...(rest.guardrails ? { guardrails: rest.guardrails } : {}),
    escalation: { rules: [], handoffMessage: 'Te paso con el equipo.', ...rest.escalation },
  });
  if (!result.ok) {
    throw new Error(`makeAgentConfig produced an invalid config: ${JSON.stringify(result.errors)}`);
  }
  return result.config;
}

interface StoredAgentTurn extends NewAgentTurn {
  tenant_id: string;
}

export class FakeDb implements RuntimeDb {
  tenants = new Map<
    string,
    {
      tenant: TenantContext;
      promptVersion: PromptVersionRow | null;
      config: AgentConfig | null;
      draftConfig: AgentConfig | null;
    }
  >();
  conversations: ConversationRow[] = [];
  messages: MessageRow[] = [];
  agentTurns: StoredAgentTurn[] = [];
  // ws-r2 tool-backing tables.
  customers: CustomerRow[] = [];
  products: ProductRow[] = [];
  categories: { id: string; tenant_id: string; name: string }[] = [];
  orderStatuses: { id: string; tenant_id: string; name: string; kind: string }[] = [];
  orders: OrderRow[] = [];
  orderItems: OrderItemRow[] = [];
  events = new Map<string, WebhookEventRow>();
  queueMessages: QueueMessage[] = [];
  archived: number[] = [];
  private nextMsgId = 1;
  // Anchored to the real clock: the pipeline's 24h-window guard compares
  // row timestamps against real `Date.now()`, so a fixed past date would
  // start failing once it drifted >24h behind.
  private clock = Date.now();

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
    this.tenants.set(seed.phoneNumberId, {
      tenant: seed.tenant,
      promptVersion,
      config: seed.config === undefined ? makeAgentConfig() : seed.config,
      draftConfig: seed.draftConfig ?? null,
    });
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

  addCustomer(partial: Partial<CustomerRow> & { tenant_id: string }): CustomerRow {
    const customer = {
      id: randomUUID(),
      created_at: this.now(),
      updated_at: this.now(),
      wa_id: null,
      phone: null,
      name: null,
      email: null,
      address: null,
      city: null,
      gender: null,
      age_group: null,
      attributes: {},
      consent_status: 'unknown',
      source: 'agent',
      total_spent: 0,
      last_order_at: null,
      last_message_at: null,
      ...partial,
    } as CustomerRow;
    this.customers.push(customer);
    return customer;
  }

  addProduct(partial: Partial<ProductRow> & { tenant_id: string; name: string }): ProductRow {
    const product = {
      id: randomUUID(),
      created_at: this.now(),
      updated_at: this.now(),
      category_id: null,
      description: null,
      price: 10000,
      promo_price: null,
      available: true,
      image_paths: [],
      ...partial,
    } as ProductRow;
    this.products.push(product);
    return product;
  }

  addCategory(tenantId: string, name: string): { id: string; tenant_id: string; name: string } {
    const category = { id: randomUUID(), tenant_id: tenantId, name };
    this.categories.push(category);
    return category;
  }

  addOrderStatus(tenantId: string, name: string, kind: string) {
    const status = { id: randomUUID(), tenant_id: tenantId, name, kind };
    this.orderStatuses.push(status);
    return status;
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
      getPublishedConfig() {
        return Promise.resolve(entry?.config ?? null);
      },
      getDraftConfig() {
        return Promise.resolve(entry?.draftConfig ?? null);
      },
      setConversationPause(conversationId: string, pausedUntilIso: string | null) {
        const conversation = db.conversations.find(
          (c) => c.tenant_id === tenantId && c.id === conversationId,
        );
        if (conversation) {
          conversation.bot_paused = true;
          conversation.paused_until = pausedUntilIso;
        }
        return Promise.resolve();
      },
      clearConversationPause(conversationId: string) {
        const conversation = db.conversations.find(
          (c) => c.tenant_id === tenantId && c.id === conversationId,
        );
        if (conversation) {
          conversation.bot_paused = false;
          conversation.paused_until = null;
        }
        return Promise.resolve();
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
        if (message && shouldRecordStatus(message.wa_status, status)) {
          message.wa_status = status;
        }
        return Promise.resolve();
      },

      // ── ws-r2 agent tools ─────────────────────────────────────────────────
      // Each filters on tenantId exactly as the real repo does, so a test that
      // forges a foreign id gets the same empty result the database would give.

      hasAnyProduct() {
        return Promise.resolve(db.products.some((p) => p.tenant_id === tenantId));
      },
      searchProducts(search: CatalogSearch) {
        let rows = db.products.filter((p) => p.tenant_id === tenantId);
        if (search.onlyAvailable !== false) rows = rows.filter((p) => p.available);
        // Same token matching + ranking the real repo does, so unit tests
        // reflect how search actually behaves against Postgres.
        const tokens = [
          ...new Set(
            (search.query ?? '')
              .replace(/[,()\\]/g, ' ')
              .toLowerCase()
              .split(/\s+/)
              .filter((t) => t.length > 1),
          ),
        ];
        const score = (p: ProductRow): number => {
          const haystack = `${p.name} ${p.description ?? ''}`.toLowerCase();
          return tokens.reduce((n, t) => (haystack.includes(t) ? n + 1 : n), 0);
        };
        if (tokens.length > 0) rows = rows.filter((p) => score(p) > 0);
        if (search.category) {
          const wanted = search.category.toLowerCase();
          rows = rows.filter((p) => {
            const category = db.categories.find((c) => c.id === p.category_id);
            return category?.name.toLowerCase() === wanted;
          });
        }
        const sorted = [...rows].sort(
          (a, b) => score(b) - score(a) || a.name.localeCompare(b.name),
        );
        return Promise.resolve(
          sorted.slice(0, search.limit).map((product) => ({
            ...product,
            category_name: db.categories.find((c) => c.id === product.category_id)?.name ?? null,
          })),
        );
      },
      getProductsByIds(ids: string[]) {
        return Promise.resolve(
          db.products.filter((p) => p.tenant_id === tenantId && ids.includes(p.id)),
        );
      },
      getConversationCustomer(conversationId: string) {
        const conversation = db.conversations.find(
          (c) => c.tenant_id === tenantId && c.id === conversationId,
        );
        if (!conversation?.customer_id) return Promise.resolve(null);
        return Promise.resolve(
          db.customers.find((c) => c.tenant_id === tenantId && c.id === conversation.customer_id) ??
            null,
        );
      },
      updateCustomerCapture(customerId: string, patch: Record<string, unknown>) {
        const customer = db.customers.find(
          (c) => c.tenant_id === tenantId && c.id === customerId,
        );
        if (!customer) throw new Error(`fake: no customer ${customerId} for tenant ${tenantId}`);
        Object.assign(customer, patch);
        return Promise.resolve(customer);
      },
      getInitialOrderStatus() {
        const status = db.orderStatuses.find(
          (s) => s.tenant_id === tenantId && s.kind === 'new',
        );
        return Promise.resolve(
          status
            ? ({ ...status, created_at: db.now(), sort_order: 0 } as unknown as never)
            : null,
        );
      },
      createOrder(input: NewOrder) {
        const order = {
          id: randomUUID(),
          created_at: db.now(),
          updated_at: db.now(),
          tenant_id: tenantId,
          customer_id: input.customerId,
          conversation_id: input.conversationId,
          status_id: input.statusId,
          total: input.total,
          currency: input.currency,
          payment_method_id: null,
          payment_reference: null,
          payment_proof_media_path: null,
          payment_verified_at: null,
          delivery_address: input.deliveryAddress,
          delivery_date: input.deliveryDate,
          driver_notes: input.driverNotes,
          source: 'agent',
          campaign_id: null,
        } as OrderRow;
        db.orders.push(order);

        const items = input.items.map(
          (item, index) =>
            ({
              id: randomUUID(),
              created_at: db.now(),
              tenant_id: tenantId,
              order_id: order.id,
              product_id: item.product_id,
              description: item.description,
              qty: item.qty,
              unit_price: item.unit_price,
              sort_order: index,
            }) as OrderItemRow,
        );
        db.orderItems.push(...items);

        // Mirror the D2 trigger so unit tests see the same rollup the DB keeps.
        const customer = db.customers.find((c) => c.id === input.customerId);
        if (customer) {
          customer.total_spent = db.orders
            .filter((o) => o.customer_id === customer.id)
            .reduce((sum, o) => sum + Number(o.total), 0);
          customer.last_order_at = order.created_at;
        }

        return Promise.resolve({ order, items });
      },
      setConversationNeedsAttention(conversationId: string, needsAttention: boolean) {
        const conversation = db.conversations.find(
          (c) => c.tenant_id === tenantId && c.id === conversationId,
        );
        if (conversation) conversation.needs_attention = needsAttention;
        return Promise.resolve();
      },
      getTenantMeta() {
        return Promise.resolve({
          currency: entry?.tenant.currency ?? 'COP',
          timezone: entry?.tenant.timezone ?? 'America/Bogota',
          vertical: entry?.config?.business.vertical ?? 'retail',
          agentEnabled: entry?.tenant.agentEnabled ?? true,
        });
      },
      publishConfig(input: {
        config: AgentConfig;
        compiledPrompt: string;
        compilerVersion: string;
        vertical: string;
      }) {
        void input;
        return Promise.resolve({ versionId: randomUUID() });
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
