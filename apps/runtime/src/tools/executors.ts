/**
 * The four tool executors (ws-r2 §3).
 *
 * Every one follows the same shape: validate the model's arguments with the
 * shared Zod schema, act through the tenant-scoped repo, return a compact
 * structured result the model can narrate. Validation failures come back as
 * `ok: false` so the model can correct itself — they never throw into the
 * pipeline, because one malformed argument should not poison a queue message.
 */
import {
  CaptureCustomerSchema,
  CATALOG_RESULT_LIMIT,
  CheckCatalogArgsSchema,
  CreateOrderArgsSchema,
  HandoffToHumanArgsSchema,
  OrderCreateSchema,
  computeOrderTotal,
  effectivePrice,
  type AttributeValue,
  type Json,
} from '@optiax/shared';
import type { ToolContext, ToolOutcome } from './types.js';

/**
 * Compact a Zod failure into something a model can act on. Typed structurally
 * rather than importing `zod` — it is a dependency of `packages/shared`, not of
 * the runtime, and this is the only shape we need from it.
 */
interface ZodIssueLike {
  path: (string | number)[];
  message: string;
}

function invalidArgs(error: { issues: ZodIssueLike[] }): ToolOutcome {
  return {
    ok: false,
    error: 'invalid_arguments',
    details: error.issues.map((issue) => ({
      field: issue.path.join('.'),
      problem: issue.message,
    })),
  };
}

// ── check_catalog ───────────────────────────────────────────────────────────

/**
 * The only price source in the system. The catalog is deliberately never
 * compiled into the prompt (phase-0 §6), so a price edited in the dashboard is
 * live on the very next message rather than at the next prompt recompile.
 */
export async function checkCatalog(args: Json, ctx: ToolContext): Promise<ToolOutcome> {
  const parsed = CheckCatalogArgsSchema.safeParse(args ?? {});
  if (!parsed.success) return invalidArgs(parsed.error);

  const { canQuotePrices, offerPromos } = ctx.config.catalog;
  const products = await ctx.repo.searchProducts({
    query: parsed.data.query,
    category: parsed.data.category,
    onlyAvailable: parsed.data.onlyAvailable,
    limit: CATALOG_RESULT_LIMIT,
  });

  if (products.length === 0) {
    return {
      ok: true,
      result: {
        products: [],
        note: 'No products matched. Do not invent one — say you could not find it and offer to check something else.',
      },
    };
  }

  return {
    ok: true,
    result: {
      products: products.map((product) => ({
        product_id: product.id,
        name: product.name,
        description: product.description,
        category: product.category_name,
        available: product.available,
        // A tenant who turned off price quoting gets no numbers in the tool
        // result at all — withholding them here is stronger than instructing
        // the model not to say them.
        ...(canQuotePrices
          ? {
              price: product.price,
              ...(offerPromos && product.promo_price !== null
                ? { promo_price: product.promo_price }
                : {}),
            }
          : {}),
      })),
      ...(canQuotePrices
        ? {}
        : { note: 'This business does not quote prices in chat. Invite the customer to ask the team.' }),
    },
  };
}

// ── capture_customer ────────────────────────────────────────────────────────

/**
 * Upserts onto the conversation's existing customer row — never creates a
 * second one. The row already exists: `getOrCreateConversation` created it from
 * the WhatsApp identity before the agent ever ran, which is what makes `wa_id`
 * dedupe automatic rather than something this tool has to get right.
 */
export async function captureCustomer(args: Json, ctx: ToolContext): Promise<ToolOutcome> {
  const parsed = CaptureCustomerSchema.safeParse(args ?? {});
  if (!parsed.success) return invalidArgs(parsed.error);

  const customer = await ctx.repo.getConversationCustomer(ctx.conversationId);
  if (!customer) {
    return { ok: false, error: 'no_customer_on_conversation' };
  }

  const { attributes, ...identity } = parsed.data;

  // Only the keys the tenant actually configured may be written; anything else
  // the model invents is dropped and reported, not silently stored.
  const allowedKeys = new Set(ctx.config.capture.fields.map((f) => f.key));
  const accepted: Record<string, AttributeValue> = {};
  const rejected: string[] = [];
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (allowedKeys.has(key)) accepted[key] = value;
    else rejected.push(key);
  }

  // Built key-by-key rather than spread: under exactOptionalPropertyTypes an
  // explicit `undefined` is not the same as an absent key, and we must not
  // write undefined over a value the customer gave us earlier.
  const patch: Parameters<ToolContext['repo']['updateCustomerCapture']>[1] = {};
  for (const [key, value] of Object.entries(identity)) {
    if (value !== undefined) Object.assign(patch, { [key]: value });
  }
  if (Object.keys(accepted).length > 0) {
    // Merge, so capturing one attribute never erases the others.
    const existing = (customer.attributes ?? {}) as Record<string, AttributeValue>;
    patch.attributes = { ...existing, ...accepted };
  }

  if (Object.keys(patch).length === 0) {
    return {
      ok: false,
      error: 'nothing_to_save',
      details: { unknown_attributes: rejected },
    };
  }

  // `source` is deliberately not in the patch: an imported or manually created
  // customer must not flip to 'agent' just because the agent learned their city.
  const updated = await ctx.repo.updateCustomerCapture(customer.id, patch);
  ctx.log(`[tool] capture_customer saved ${Object.keys(patch).join(', ')} for ${updated.id}`);

  return {
    ok: true,
    result: {
      saved: Object.keys(patch),
      ...(rejected.length > 0
        ? { ignored_attributes: rejected, note: 'Those attribute keys are not configured for this business.' }
        : {}),
    },
  };
}

// ── create_order ────────────────────────────────────────────────────────────

export async function createOrder(args: Json, ctx: ToolContext): Promise<ToolOutcome> {
  if (!ctx.config.orders.enabled) {
    return { ok: false, error: 'orders_disabled' };
  }

  const parsed = CreateOrderArgsSchema.safeParse(args ?? {});
  if (!parsed.success) return invalidArgs(parsed.error);
  const { items, confirmed, ...logistics } = parsed.data;

  if (ctx.config.orders.confirmBeforeCreate && confirmed !== true) {
    return {
      ok: false,
      error: 'confirmation_required',
      details: {
        note: 'Recap the items, quantities and total to the customer, get an explicit yes, then call again with confirmed: true.',
      },
    };
  }

  const customer = await ctx.repo.getConversationCustomer(ctx.conversationId);
  if (!customer) return { ok: false, error: 'no_customer_on_conversation' };

  const status = await ctx.repo.getInitialOrderStatus();
  if (!status) {
    // Tenant misconfiguration, not something the model can fix by retrying.
    ctx.log('[tool] create_order: tenant has no order_status with kind=new');
    return { ok: false, error: 'orders_not_configured' };
  }

  // Prices and names come from the catalog, never from the model. Ids that
  // belong to another tenant simply do not come back from the repo, so a
  // forged product_id lands in `unknown` rather than on an order.
  const requestedIds = [...new Set(items.map((item) => item.product_id))];
  const products = await ctx.repo.getProductsByIds(requestedIds);
  const byId = new Map(products.map((product) => [product.id, product]));

  const unknown = requestedIds.filter((id) => !byId.has(id));
  if (unknown.length > 0) {
    return {
      ok: false,
      error: 'unknown_products',
      details: {
        product_ids: unknown,
        note: 'Call check_catalog again and use the product_id values it returns.',
      },
    };
  }

  const unavailable = requestedIds.filter((id) => byId.get(id)?.available === false);
  if (unavailable.length > 0) {
    return {
      ok: false,
      error: 'products_unavailable',
      details: {
        products: unavailable.map((id) => ({ product_id: id, name: byId.get(id)?.name ?? null })),
        note:
          ctx.config.catalog.outOfStock === 'suggest_alternative'
            ? 'Tell the customer and suggest the closest available alternative from check_catalog.'
            : 'Tell the customer plainly that it is unavailable. Do not offer a substitute.',
      },
    };
  }

  const lines = items.map((item) => {
    // Non-null: every id was resolved above.
    const product = byId.get(item.product_id)!;
    return {
      product_id: product.id,
      description: product.name,
      qty: item.qty,
      unit_price: effectivePrice(product),
    };
  });

  // The composed write is validated by D2's schema verbatim — the model-facing
  // shape is narrower, but what reaches the DB goes through the same contract
  // the dashboard composer uses.
  const write = OrderCreateSchema.safeParse({
    customer_id: customer.id,
    items: lines,
    payment_method_id: null,
    payment_reference: null,
    delivery_address: logistics.delivery_address ?? null,
    delivery_date: logistics.delivery_date ?? null,
    driver_notes: logistics.driver_notes ?? null,
  });
  if (!write.success) return invalidArgs(write.error);

  const total = computeOrderTotal(write.data.items);
  const { order, items: created } = await ctx.repo.createOrder({
    customerId: write.data.customer_id,
    conversationId: ctx.conversationId,
    statusId: status.id,
    total,
    currency: ctx.currency,
    deliveryAddress: write.data.delivery_address,
    deliveryDate: write.data.delivery_date,
    driverNotes: write.data.driver_notes,
    items: write.data.items,
  });

  ctx.log(`[tool] create_order created ${order.id} (${created.length} items, total ${total})`);

  return {
    ok: true,
    result: {
      order_id: order.id,
      status: status.name,
      total,
      currency: order.currency,
      items: created
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((item) => ({ description: item.description, qty: item.qty, unit_price: item.unit_price })),
    },
  };
}

// ── handoff_to_human ────────────────────────────────────────────────────────

/**
 * Terminal by construction: `stopLoop` ends the tool loop and `reply` is the
 * configured handoff message, sent verbatim. The model does not get to
 * paraphrase it — the business wrote those words on purpose.
 *
 * The pause is indefinite (`paused_until: null`), matching the manual dashboard
 * toggle: a human now owns this conversation and only a human should hand it
 * back. A timed pause would have the bot silently resume mid-problem.
 */
export async function handoffToHuman(args: Json, ctx: ToolContext): Promise<ToolOutcome> {
  const parsed = HandoffToHumanArgsSchema.safeParse(args ?? {});
  if (!parsed.success) return invalidArgs(parsed.error);

  await ctx.repo.setConversationNeedsAttention(ctx.conversationId, true);
  await ctx.repo.setConversationPause(ctx.conversationId, null);

  ctx.log(
    `[tool] handoff_to_human conv=${ctx.conversationId} reason=${parsed.data.reason}` +
      (parsed.data.note ? ` note=${parsed.data.note}` : ''),
  );

  return {
    ok: true,
    stopLoop: true,
    reply: ctx.config.escalation.handoffMessage,
    result: { handed_off: true, reason: parsed.data.reason },
  };
}
