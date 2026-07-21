/**
 * Ephemeral, non-persisting TenantRepo for the Playground (ws-d3 §1).
 *
 * The Playground runs the REAL R2 tool loop against the tenant's draft config,
 * but nothing it does may touch the tenant's data. This repo splits the surface:
 *
 *   - Catalog / order-status / tenant-meta READS delegate to the real
 *     tenant-scoped repo, so `check_catalog` quotes live prices and
 *     `create_order` prices from the real catalog — read-only.
 *   - Customer + order WRITES land in an in-memory buffer and are reported back,
 *     never persisted. `capture_customer` mutates a throwaway customer;
 *     `create_order` synthesizes an order the UI can show ("crearía un pedido").
 *   - Every method the loop never calls throws, so an unexpected code path can
 *     only fail loudly — it can never quietly write to the tenant's tables.
 *
 * Reuses the R3 pluggable-DB seam (a TenantRepo is a TenantRepo); it does not
 * fork the loop or the executors.
 */
import { randomUUID } from 'node:crypto';
import type {
  CustomerRow,
  NewOrder,
  OrderItemRow,
  OrderRow,
  TenantRepo,
} from '../db/index.js';

/** What the Playground buffered instead of persisting — for tests + reporting. */
export interface PlaygroundBuffer {
  customer: CustomerRow;
  orders: OrderRow[];
  orderItems: OrderItemRow[];
  needsAttention: boolean;
  botPaused: boolean;
}

const unsupported = (method: string): Promise<never> =>
  Promise.reject(new Error(`playground-repo: ${method} is not available in test mode`));

/**
 * Build a non-persisting repo backed by `real` for catalog reads. `conversationId`
 * is the synthetic id the loop binds; the single ephemeral customer answers for it.
 */
export function createPlaygroundRepo(
  real: TenantRepo,
  tenantId: string,
): { repo: TenantRepo; buffer: PlaygroundBuffer } {
  let clock = Date.now();
  const now = (): string => new Date((clock += 1000)).toISOString();

  const buffer: PlaygroundBuffer = {
    customer: {
      id: randomUUID(),
      tenant_id: tenantId,
      wa_id: 'playground',
      phone: 'playground',
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
      created_at: now(),
      updated_at: now(),
    } as CustomerRow,
    orders: [],
    orderItems: [],
    needsAttention: false,
    botPaused: false,
  };

  const repo: TenantRepo = {
    // ── Real, read-only catalog + tenant metadata ────────────────────────────
    hasAnyProduct: () => real.hasAnyProduct(),
    searchProducts: (search) => real.searchProducts(search),
    getProductsByIds: (ids) => real.getProductsByIds(ids),
    getInitialOrderStatus: () => real.getInitialOrderStatus(),
    getTenantMeta: () => real.getTenantMeta(),

    // ── Ephemeral customer ───────────────────────────────────────────────────
    getConversationCustomer: () => Promise.resolve(buffer.customer),
    updateCustomerCapture: (_customerId, patch) => {
      Object.assign(buffer.customer, patch);
      return Promise.resolve(buffer.customer);
    },

    // ── Buffered order (reported, never persisted) ───────────────────────────
    createOrder: (input: NewOrder) => {
      const order = {
        id: randomUUID(),
        created_at: now(),
        updated_at: now(),
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
      const items = input.items.map(
        (item, index) =>
          ({
            id: randomUUID(),
            created_at: now(),
            tenant_id: tenantId,
            order_id: order.id,
            product_id: item.product_id,
            description: item.description,
            qty: item.qty,
            unit_price: item.unit_price,
            sort_order: index,
          }) as OrderItemRow,
      );
      buffer.orders.push(order);
      buffer.orderItems.push(...items);
      return Promise.resolve({ order, items });
    },

    // ── Handoff / pause flags (ephemeral) ────────────────────────────────────
    setConversationNeedsAttention: (_conversationId, needsAttention) => {
      buffer.needsAttention = needsAttention;
      return Promise.resolve();
    },
    setConversationPause: (_conversationId, _pausedUntilIso) => {
      buffer.botPaused = true;
      return Promise.resolve();
    },
    clearConversationPause: () => {
      buffer.botPaused = false;
      return Promise.resolve();
    },

    // ── Never reached by the tool loop; persisting these would defeat the point ─
    getOrCreateConversation: () => unsupported('getOrCreateConversation'),
    getActivePromptVersion: () => unsupported('getActivePromptVersion'),
    getPublishedConfig: () => unsupported('getPublishedConfig'),
    getDraftConfig: () => unsupported('getDraftConfig'),
    insertMessage: () => unsupported('insertMessage'),
    listRecentMessages: () => unsupported('listRecentMessages'),
    hasOutboundReplyAfter: () => unsupported('hasOutboundReplyAfter'),
    insertAgentTurn: () => unsupported('insertAgentTurn'),
    updateConversationTimestamps: () => unsupported('updateConversationTimestamps'),
    updateMessageWaStatus: () => unsupported('updateMessageWaStatus'),
    publishConfig: () => unsupported('publishConfig'),
  };

  return { repo, buffer };
}
