/**
 * In-memory RuntimeDb for the eval harness (ws-r3 §1).
 *
 * The eval harness drives the *real* pipeline (processWebhookEvent → the real
 * R2 tool loop → the real executors → the real compiler-produced prompt). Only
 * the storage layer is in-memory, and it is seeded fresh per fixture, so every
 * run is hermetic with nothing to tear down — the strongest form of "clean up
 * after themselves" (the hard rule), and it needs no network, so the
 * deterministic layer runs in the default `pnpm test` gate.
 *
 * This deliberately mirrors the tenant-scoping and catalog-search behavior of
 * the real repo (src/db/index.ts) so eval outcomes reflect production. The
 * service client stays untouched in src/db/; the harness is DB-pluggable
 * (evaluate.ts takes a factory) so a real-Supabase disposable tenant can back
 * it later without touching the gate logic — see SESSION_NOTES.
 */
import { randomUUID } from 'node:crypto';
import type {
  AgentConfig,
  EvalCatalogProduct,
  EvalConversationState,
  Json,
} from '@optiax/shared';
import type {
  CatalogProduct,
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
  RuntimeDb,
  TenantContext,
  TenantRepo,
  WaStatus,
  WebhookEventRow,
} from '../db/index.js';
import { shouldRecordStatus } from '../wa/status-rank.js';

const HOUR_MS = 3_600_000;

/** What a fixture seeds before its turns run. */
export interface EvalDbSeed {
  vertical: string;
  config: AgentConfig;
  compiledPrompt: string;
  currency: string;
  timezone: string;
  catalog: EvalCatalogProduct[];
}

/** Split a query into tokens exactly as the real repo does (src/db/index.ts). */
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

function tokenScore(name: string, description: string | null, tokens: string[]): number {
  const haystack = `${name} ${description ?? ''}`.toLowerCase();
  return tokens.reduce((score, token) => (haystack.includes(token) ? score + 1 : score), 0);
}

export class EvalDb implements RuntimeDb {
  readonly tenantId = randomUUID();
  readonly phoneNumberId = `eval-${randomUUID().slice(0, 12)}`;
  private readonly promptVersionId = randomUUID();

  private readonly conversations: ConversationRow[] = [];
  private readonly customers: CustomerRow[] = [];
  private readonly products: ProductRow[] = [];
  private readonly categories = new Map<string, string>(); // category_id → name
  private readonly orderStatuses: { id: string; name: string; kind: string }[] = [];
  readonly orders: OrderRow[] = [];
  readonly orderItems: OrderItemRow[] = [];
  readonly messages: MessageRow[] = [];
  readonly agentTurns: (NewAgentTurn & { tenant_id: string })[] = [];
  private readonly events = new Map<string, WebhookEventRow>();
  private clock = Date.now();

  constructor(private readonly seed: EvalDbSeed) {
    // Full order-status pipeline so create_order (kind='new') and the Q-D
    // awaiting_payment seed both resolve.
    for (const [name, kind] of [
      ['Nuevo', 'new'],
      ['Esperando pago', 'awaiting_payment'],
      ['Entregado', 'delivered'],
    ] as const) {
      this.orderStatuses.push({ id: randomUUID(), name, kind });
    }
    for (const p of seed.catalog) {
      let categoryId: string | null = null;
      if (p.category) {
        categoryId =
          [...this.categories.entries()].find(([, n]) => n === p.category)?.[0] ?? randomUUID();
        this.categories.set(categoryId, p.category);
      }
      this.products.push({
        id: p.id,
        tenant_id: this.tenantId,
        category_id: categoryId,
        name: p.name,
        description: p.description ?? null,
        price: p.price,
        promo_price: p.promoPrice ?? null,
        available: p.available ?? true,
        image_paths: [],
        created_at: this.now(),
        updated_at: this.now(),
      } as ProductRow);
    }
  }

  private now(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  // ── Seeding helpers (harness-only, before turns run) ───────────────────────

  /** Pre-create the conversation + its customer with the fixture's initial state. */
  seedConversation(waId: string, state: EvalConversationState = {}): { conversationId: string; customerId: string } {
    const customer: CustomerRow = {
      id: randomUUID(),
      tenant_id: this.tenantId,
      wa_id: waId,
      phone: waId,
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
      created_at: this.now(),
      updated_at: this.now(),
    } as CustomerRow;
    this.customers.push(customer);

    const pausedUntil =
      state.pausedUntilMinutes === undefined || state.pausedUntilMinutes === null
        ? null
        : new Date(Date.now() + state.pausedUntilMinutes * 60_000).toISOString();
    const lastCustomerMessageAt =
      state.lastCustomerMessageAtHoursAgo === undefined
        ? null
        : new Date(Date.now() - state.lastCustomerMessageAtHoursAgo * HOUR_MS).toISOString();

    const conversation: ConversationRow = {
      id: randomUUID(),
      tenant_id: this.tenantId,
      customer_id: customer.id,
      wa_id: waId,
      bot_paused: state.botPaused ?? false,
      paused_until: pausedUntil,
      last_customer_message_at: lastCustomerMessageAt,
      last_message_at: lastCustomerMessageAt,
      needs_attention: state.needsAttention ?? false,
      created_at: this.now(),
      updated_at: this.now(),
    } as ConversationRow;
    this.conversations.push(conversation);

    if (state.openAwaitingPaymentOrder) {
      const status = this.orderStatuses.find((s) => s.kind === 'awaiting_payment')!;
      this.orders.push({
        id: randomUUID(),
        tenant_id: this.tenantId,
        customer_id: customer.id,
        conversation_id: conversation.id,
        status_id: status.id,
        total: 50000,
        currency: this.seed.currency,
        payment_method_id: null,
        payment_reference: null,
        payment_proof_media_path: null,
        payment_verified_at: null,
        delivery_address: null,
        delivery_date: null,
        driver_notes: null,
        source: 'agent',
        campaign_id: null,
        created_at: this.now(),
        updated_at: this.now(),
      } as OrderRow);
    }

    return { conversationId: conversation.id, customerId: customer.id };
  }

  /**
   * Pre-insert an inbound message with a known wa_message_id so the matching
   * webhook is treated as a redelivery (wasDuplicate) — the only way the fresh
   * inbound does not reset the 24h window, exercising the outside-window path.
   */
  seedInboundMessage(conversationId: string, waMessageId: string, body: string): void {
    this.messages.push({
      id: randomUUID(),
      tenant_id: this.tenantId,
      conversation_id: conversationId,
      wa_message_id: waMessageId,
      direction: 'inbound',
      source: 'customer',
      type: 'text',
      body,
      media_path: null,
      template_name: null,
      campaign_id: null,
      wa_status: null,
      error: null,
      created_at: this.now(),
    } as MessageRow);
  }

  addEvent(payload: Json): string {
    const id = randomUUID();
    this.events.set(id, {
      id,
      created_at: this.now(),
      tenant_id: null,
      provider: '360dialog',
      event_type: 'messages',
      payload,
      processed_at: null,
      error: null,
    } as WebhookEventRow);
    return id;
  }

  // ── RuntimeDb surface ──────────────────────────────────────────────────────

  resolveTenantByPhoneNumberId(phoneNumberId: string): Promise<TenantContext | null> {
    if (phoneNumberId !== this.phoneNumberId) return Promise.resolve(null);
    return Promise.resolve({
      id: this.tenantId,
      name: 'Eval Tenant',
      agentEnabled: true,
      activePromptVersionId: this.promptVersionId,
      timezone: this.seed.timezone,
      currency: this.seed.currency,
    });
  }

  webhookEvents = {
    insert: (input: { eventType: string; payload: Json; tenantId: string | null }) =>
      Promise.resolve(this.addEvent(input.payload)),
    get: (id: string) => Promise.resolve(this.events.get(id) ?? null),
    markProcessed: (id: string) => {
      const e = this.events.get(id);
      if (e) e.processed_at = this.now();
      return Promise.resolve();
    },
    markError: (id: string, error: Json) => {
      const e = this.events.get(id);
      if (e) e.error = error;
      return Promise.resolve();
    },
  };

  // The pipeline never touches the queue directly; stub it to satisfy RuntimeDb.
  queue = {
    send: () => Promise.resolve(),
    read: () => Promise.resolve([]),
    archive: () => Promise.resolve(),
  };

  createTenantRepo(tenantId: string): TenantRepo {
    if (tenantId !== this.tenantId) throw new Error(`eval-db: unknown tenant ${tenantId}`);
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- returned object uses method shorthand, so `this` inside it is rebound
    const db = this;
    return {
      getOrCreateConversation(waId, profileName) {
        void profileName; // eval-db pre-seeds the conversation; profile name unused
        const existing = db.conversations.find((c) => c.wa_id === waId);
        if (existing) return Promise.resolve(existing);
        // Fixtures pre-seed their conversation; only reached if none was seeded.
        const { conversationId } = db.seedConversation(waId);
        return Promise.resolve(db.conversations.find((c) => c.id === conversationId)!);
      },
      getActivePromptVersion() {
        return Promise.resolve({
          id: db.promptVersionId,
          tenant_id: db.tenantId,
          compiled_prompt: db.seed.compiledPrompt,
          config_snapshot: {},
          compiler_version: 'eval',
          vertical: db.seed.vertical,
          created_at: db.now(),
        } as PromptVersionRow);
      },
      getPublishedConfig() {
        return Promise.resolve(db.seed.config);
      },
      getDraftConfig() {
        return Promise.resolve(db.seed.config);
      },
      setConversationPause(conversationId, pausedUntilIso) {
        const c = db.conversations.find((x) => x.id === conversationId);
        if (c) {
          c.bot_paused = true;
          c.paused_until = pausedUntilIso;
        }
        return Promise.resolve();
      },
      clearConversationPause(conversationId) {
        const c = db.conversations.find((x) => x.id === conversationId);
        if (c) {
          c.bot_paused = false;
          c.paused_until = null;
        }
        return Promise.resolve();
      },
      insertMessage(input: NewMessage) {
        if (input.wa_message_id) {
          const existing = db.messages.find((m) => m.wa_message_id === input.wa_message_id);
          if (existing) return Promise.resolve({ message: existing, wasDuplicate: true });
        }
        const message: MessageRow = {
          id: randomUUID(),
          created_at: db.now(),
          tenant_id: db.tenantId,
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
        } as MessageRow;
        db.messages.push(message);
        return Promise.resolve({ message, wasDuplicate: false });
      },
      listRecentMessages(conversationId, limit) {
        const all = db.messages.filter((m) => m.conversation_id === conversationId);
        return Promise.resolve(all.slice(-limit));
      },
      hasOutboundReplyAfter(conversationId, afterIso) {
        return Promise.resolve(
          db.messages.some(
            (m) =>
              m.conversation_id === conversationId && m.direction === 'outbound' && m.created_at > afterIso,
          ),
        );
      },
      insertAgentTurn(input: NewAgentTurn) {
        db.agentTurns.push({ ...input, tenant_id: db.tenantId });
        return Promise.resolve();
      },
      updateConversationTimestamps(conversationId, patch) {
        const c = db.conversations.find((x) => x.id === conversationId);
        if (c) {
          if (patch.lastMessageAt !== undefined) c.last_message_at = patch.lastMessageAt;
          if (patch.lastCustomerMessageAt !== undefined) c.last_customer_message_at = patch.lastCustomerMessageAt;
        }
        return Promise.resolve();
      },
      updateMessageWaStatus(waMessageId, status: WaStatus) {
        const m = db.messages.find((x) => x.wa_message_id === waMessageId);
        if (m && shouldRecordStatus(m.wa_status, status)) m.wa_status = status;
        return Promise.resolve();
      },
      hasAnyProduct() {
        return Promise.resolve(db.products.length > 0);
      },
      searchProducts(search: CatalogSearch) {
        let rows = db.products.slice();
        if (search.onlyAvailable !== false) rows = rows.filter((p) => p.available);
        const tokens = searchTokens(search.query);
        if (tokens.length > 0) rows = rows.filter((p) => tokenScore(p.name, p.description, tokens) > 0);
        if (search.category) {
          const wanted = search.category.toLowerCase();
          rows = rows.filter((p) => db.categories.get(p.category_id ?? '')?.toLowerCase() === wanted);
        }
        const ranked = rows
          .map((row) => ({ row, score: tokenScore(row.name, row.description, tokens) }))
          .sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name))
          .map(({ row }) => row);
        const result: CatalogProduct[] = ranked.slice(0, search.limit).map((product) => ({
          ...product,
          category_name: db.categories.get(product.category_id ?? '') ?? null,
        }));
        return Promise.resolve(result);
      },
      getProductsByIds(ids) {
        return Promise.resolve(db.products.filter((p) => ids.includes(p.id)));
      },
      getConversationCustomer(conversationId) {
        const c = db.conversations.find((x) => x.id === conversationId);
        if (!c?.customer_id) return Promise.resolve(null);
        return Promise.resolve(db.customers.find((x) => x.id === c.customer_id) ?? null);
      },
      updateCustomerCapture(customerId, patch) {
        const customer = db.customers.find((x) => x.id === customerId);
        if (!customer) throw new Error(`eval-db: no customer ${customerId}`);
        Object.assign(customer, patch);
        return Promise.resolve(customer);
      },
      getInitialOrderStatus() {
        const status = db.orderStatuses.find((s) => s.kind === 'new');
        return Promise.resolve(
          status ? ({ ...status, tenant_id: db.tenantId, created_at: db.now(), sort_order: 0 } as unknown as never) : null,
        );
      },
      createOrder(input: NewOrder) {
        const order: OrderRow = {
          id: randomUUID(),
          created_at: db.now(),
          updated_at: db.now(),
          tenant_id: db.tenantId,
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
              tenant_id: db.tenantId,
              order_id: order.id,
              product_id: item.product_id,
              description: item.description,
              qty: item.qty,
              unit_price: item.unit_price,
              sort_order: index,
            }) as OrderItemRow,
        );
        db.orderItems.push(...items);
        return Promise.resolve({ order, items });
      },
      setConversationNeedsAttention(conversationId, needsAttention) {
        const c = db.conversations.find((x) => x.id === conversationId);
        if (c) c.needs_attention = needsAttention;
        return Promise.resolve();
      },
    };
  }

  // ── Outcome readers (harness assertions) ───────────────────────────────────

  getConversation(conversationId: string): ConversationRow | undefined {
    return this.conversations.find((c) => c.id === conversationId);
  }

  getCustomer(customerId: string): CustomerRow | undefined {
    return this.customers.find((c) => c.id === customerId);
  }
}
