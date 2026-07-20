/**
 * Executor behavior: valid args, invalid args, empty results, cross-tenant
 * attempts, dedupe, confirmation gating (ws-r2 §3, §5, §6).
 */
import { describe, expect, it } from 'vitest';
import type { Json } from '@optiax/shared';
import {
  captureCustomer,
  checkCatalog,
  createOrder,
  handoffToHuman,
} from '../src/tools/executors.js';
import type { ToolContext } from '../src/tools/types.js';
import { FakeDb, makeAgentConfig, type AgentConfigOverrides } from './fakes.js';

const TENANT = 'aa000000-0001-4000-8000-000000000001';
const OTHER_TENANT = 'aa000000-0001-4000-8000-000000000002';

function setup(overrides: AgentConfigOverrides = {}) {
  const db = new FakeDb();
  const customer = db.addCustomer({ tenant_id: TENANT, wa_id: '573015550101', name: null });
  const conversation = db.addConversation({
    tenant_id: TENANT,
    wa_id: '573015550101',
    customer_id: customer.id,
  });
  db.addOrderStatus(TENANT, 'Nuevo', 'new');

  const logs: string[] = [];
  const ctx: ToolContext = {
    repo: db.createTenantRepo(TENANT),
    config: makeAgentConfig({}, overrides),
    conversationId: conversation.id,
    currency: 'COP',
    log: (m) => logs.push(m),
  };
  return { db, ctx, customer, conversation, logs };
}

describe('check_catalog', () => {
  it('returns matching products with prices', async () => {
    const { db, ctx } = setup();
    db.addProduct({ tenant_id: TENANT, name: 'Blusa blanca', price: 55000 });
    db.addProduct({ tenant_id: TENANT, name: 'Pantalón negro', price: 90000 });

    const outcome = await checkCatalog({ query: 'blusa' }, ctx);

    expect(outcome.ok).toBe(true);
    const result = outcome.ok ? (outcome.result as { products: { name: string; price: number }[] }) : null;
    expect(result?.products).toHaveLength(1);
    expect(result?.products[0]).toMatchObject({ name: 'Blusa blanca', price: 55000 });
  });

  /**
   * Regression, found in the live Gemini demo: the model asks the way a
   * customer talks, so the query is a descriptive phrase rather than a
   * keyword. Matching the whole phrase against one column found nothing and
   * the agent told a real customer the product did not exist.
   */
  it('matches a conversational multi-word query, ranking the best hit first', async () => {
    const { db, ctx } = setup();
    db.addProduct({
      tenant_id: TENANT,
      name: 'Blusa de lino Manuela',
      description: 'Blusa manga corta, tallas XS a XL. Colores: crudo, terracota, oliva.',
      price: 89000,
    });
    db.addProduct({ tenant_id: TENANT, name: 'Jean mom fit Antonia', price: 129000 });

    const outcome = await checkCatalog({ query: 'Blusa de Lino Manuela oliva talla M' }, ctx);

    const result = outcome.ok ? (outcome.result as { products: { name: string }[] }) : null;
    expect(result?.products[0]?.name).toBe('Blusa de lino Manuela');
  });

  it('drops single-character tokens rather than matching every product containing them', async () => {
    const { db, ctx } = setup();
    db.addProduct({ tenant_id: TENANT, name: 'Jean mom fit Antonia', price: 129000 });
    db.addProduct({ tenant_id: TENANT, name: 'Vestido Catalina', price: 159000 });

    // A query of nothing but noise leaves no tokens, which falls back to
    // listing the catalog — the same thing check_catalog does with no query at
    // all. Better a browsable list than a dead end the agent has to explain.
    const outcome = await checkCatalog({ query: 'M' }, ctx);

    const result = outcome.ok ? (outcome.result as { products: { name: string }[] }) : null;
    expect(result?.products).toHaveLength(2);
    // Ranking is inert with no tokens, so it stays alphabetical.
    expect(result?.products.map((p) => p.name)).toEqual(['Jean mom fit Antonia', 'Vestido Catalina']);
  });

  it('returns a structured no-results note instead of an empty silence', async () => {
    const { db, ctx } = setup();
    db.addProduct({ tenant_id: TENANT, name: 'Blusa blanca' });

    const outcome = await checkCatalog({ query: 'zapatos' }, ctx);

    expect(outcome.ok).toBe(true);
    const result = outcome.ok ? (outcome.result as { products: unknown[]; note: string }) : null;
    expect(result?.products).toEqual([]);
    expect(result?.note).toMatch(/Do not invent/i);
  });

  it('withholds prices entirely when the tenant does not quote prices', async () => {
    const { db, ctx } = setup({ catalog: { canQuotePrices: false } });
    db.addProduct({ tenant_id: TENANT, name: 'Blusa blanca', price: 55000 });

    const outcome = await checkCatalog({}, ctx);

    const result = outcome.ok ? (outcome.result as { products: Record<string, unknown>[] }) : null;
    // Withholding the number beats instructing the model not to say it.
    expect(result?.products[0]).not.toHaveProperty('price');
  });

  it('omits promo prices unless the tenant offers promos', async () => {
    const { db, ctx } = setup({ catalog: { offerPromos: false } });
    db.addProduct({ tenant_id: TENANT, name: 'Blusa', price: 55000, promo_price: 40000 });

    const outcome = await checkCatalog({}, ctx);
    const result = outcome.ok ? (outcome.result as { products: Record<string, unknown>[] }) : null;
    expect(result?.products[0]).not.toHaveProperty('promo_price');
  });

  it('hides unavailable products by default', async () => {
    const { db, ctx } = setup();
    db.addProduct({ tenant_id: TENANT, name: 'Blusa', available: false });

    const outcome = await checkCatalog({}, ctx);
    const result = outcome.ok ? (outcome.result as { products: unknown[] }) : null;
    expect(result?.products).toEqual([]);
  });

  it('rejects malformed args without throwing', async () => {
    const { ctx } = setup();
    const outcome = await checkCatalog({ query: 12345 } as unknown as Json, ctx);
    expect(outcome).toMatchObject({ ok: false, error: 'invalid_arguments' });
  });

  it('never returns another tenant products', async () => {
    const { db, ctx } = setup();
    db.addProduct({ tenant_id: OTHER_TENANT, name: 'Blusa de otro negocio' });

    const outcome = await checkCatalog({ query: 'blusa' }, ctx);
    const result = outcome.ok ? (outcome.result as { products: unknown[] }) : null;
    expect(result?.products).toEqual([]);
  });
});

describe('capture_customer', () => {
  it('updates the conversation customer in place — never creates a second row', async () => {
    const { db, ctx, customer } = setup();

    const outcome = await captureCustomer({ name: 'Ana Pérez', city: 'Bogotá' }, ctx);

    expect(outcome.ok).toBe(true);
    expect(db.customers).toHaveLength(1);
    expect(db.customers[0]).toMatchObject({ id: customer.id, name: 'Ana Pérez', city: 'Bogotá' });
  });

  it('keeps the original source — an imported customer does not become an agent one', async () => {
    const { db, ctx } = setup();
    db.customers[0]!.source = 'import';

    await captureCustomer({ name: 'Ana' }, ctx);

    expect(db.customers[0]?.source).toBe('import');
  });

  it('merges attributes instead of replacing them', async () => {
    const { db, ctx } = setup({
      capture: { fields: [{ key: 'talla', required: false }, { key: 'barrio', required: false }] },
    });
    db.customers[0]!.attributes = { talla: 'M' };

    await captureCustomer({ attributes: { barrio: 'Chapinero' } }, ctx);

    expect(db.customers[0]?.attributes).toEqual({ talla: 'M', barrio: 'Chapinero' });
  });

  it('drops attribute keys the tenant never configured, and says so', async () => {
    const { db, ctx } = setup({ capture: { fields: [{ key: 'talla', required: false }] } });

    const outcome = await captureCustomer(
      { attributes: { talla: 'L', descuento_secreto: '99%' } },
      ctx,
    );

    expect(db.customers[0]?.attributes).toEqual({ talla: 'L' });
    const result = outcome.ok ? (outcome.result as { ignored_attributes: string[] }) : null;
    expect(result?.ignored_attributes).toEqual(['descuento_secreto']);
  });

  it('rejects an empty patch rather than issuing a no-op write', async () => {
    const { ctx } = setup();
    const outcome = await captureCustomer({}, ctx);
    expect(outcome).toMatchObject({ ok: false });
  });

  it('rejects invalid values without throwing', async () => {
    const { ctx } = setup();
    const outcome = await captureCustomer({ email: 'not-an-email' }, ctx);
    expect(outcome).toMatchObject({ ok: false, error: 'invalid_arguments' });
  });

  it('ignores a forged tenant_id in the args — strict schema rejects it outright', async () => {
    const { ctx } = setup();
    const outcome = await captureCustomer(
      { name: 'Ana', tenant_id: OTHER_TENANT } as unknown as Json,
      ctx,
    );
    expect(outcome).toMatchObject({ ok: false, error: 'invalid_arguments' });
  });
});

describe('create_order', () => {
  const ORDERS_ON = { orders: { enabled: true, confirmBeforeCreate: false } };

  it('creates an order priced from the catalog, with sort_order in argument order', async () => {
    const { db, ctx, customer, conversation } = setup(ORDERS_ON);
    const blusa = db.addProduct({ tenant_id: TENANT, name: 'Blusa', price: 55000 });
    const pantalon = db.addProduct({ tenant_id: TENANT, name: 'Pantalón', price: 90000 });

    const outcome = await createOrder(
      { items: [{ product_id: blusa.id, qty: 2 }, { product_id: pantalon.id, qty: 1 }] },
      ctx,
    );

    expect(outcome.ok).toBe(true);
    expect(db.orders).toHaveLength(1);
    expect(db.orders[0]).toMatchObject({
      customer_id: customer.id,
      conversation_id: conversation.id,
      source: 'agent',
      total: 2 * 55000 + 90000,
      currency: 'COP',
    });
    expect(db.orderItems.map((i) => [i.description, i.sort_order])).toEqual([
      ['Blusa', 0],
      ['Pantalón', 1],
    ]);
  });

  it('prices from the catalog even when the model tries to supply its own price', async () => {
    const { db, ctx } = setup(ORDERS_ON);
    const blusa = db.addProduct({ tenant_id: TENANT, name: 'Blusa', price: 55000 });

    // unit_price is not a declared argument; strict parsing refuses the call
    // rather than silently ignoring the number.
    const outcome = await createOrder(
      { items: [{ product_id: blusa.id, qty: 1, unit_price: 1 }] } as unknown as Json,
      ctx,
    );

    expect(outcome).toMatchObject({ ok: false, error: 'invalid_arguments' });
    expect(db.orders).toHaveLength(0);
  });

  it('uses the promo price when one is set', async () => {
    const { db, ctx } = setup(ORDERS_ON);
    const blusa = db.addProduct({
      tenant_id: TENANT,
      name: 'Blusa',
      price: 55000,
      promo_price: 40000,
    });

    await createOrder({ items: [{ product_id: blusa.id, qty: 1 }] }, ctx);

    expect(db.orders[0]?.total).toBe(40000);
  });

  it('refuses when confirmBeforeCreate is on and confirmed is not true', async () => {
    const { db, ctx } = setup({ orders: { enabled: true, confirmBeforeCreate: true } });
    const blusa = db.addProduct({ tenant_id: TENANT, name: 'Blusa', price: 55000 });

    const outcome = await createOrder({ items: [{ product_id: blusa.id, qty: 1 }] }, ctx);

    expect(outcome).toMatchObject({ ok: false, error: 'confirmation_required' });
    expect(db.orders).toHaveLength(0);

    const confirmed = await createOrder(
      { items: [{ product_id: blusa.id, qty: 1 }], confirmed: true },
      ctx,
    );
    expect(confirmed.ok).toBe(true);
    expect(db.orders).toHaveLength(1);
  });

  it('refuses entirely when orders are disabled for the tenant', async () => {
    const { db, ctx } = setup({ orders: { enabled: false } });
    const blusa = db.addProduct({ tenant_id: TENANT, name: 'Blusa' });

    const outcome = await createOrder({ items: [{ product_id: blusa.id, qty: 1 }] }, ctx);

    expect(outcome).toMatchObject({ ok: false, error: 'orders_disabled' });
    expect(db.orders).toHaveLength(0);
  });

  it('reports unavailable products with config-appropriate guidance', async () => {
    const { db, ctx } = setup({
      orders: { enabled: true, confirmBeforeCreate: false },
      catalog: { outOfStock: 'suggest_alternative' },
    });
    const agotada = db.addProduct({ tenant_id: TENANT, name: 'Blusa', available: false });

    const outcome = await createOrder({ items: [{ product_id: agotada.id, qty: 1 }] }, ctx);

    expect(outcome).toMatchObject({ ok: false, error: 'products_unavailable' });
    expect(JSON.stringify(outcome)).toMatch(/alternative/i);
    expect(db.orders).toHaveLength(0);
  });

  /**
   * The scoping proof: a product id that is real, but belongs to someone else.
   * The repo is bound to this tenant, so the row never comes back and the
   * order is refused rather than quietly created against a foreign catalog.
   */
  it('refuses a product id belonging to another tenant', async () => {
    const { db, ctx } = setup(ORDERS_ON);
    const foreign = db.addProduct({ tenant_id: OTHER_TENANT, name: 'Blusa ajena', price: 1 });

    const outcome = await createOrder({ items: [{ product_id: foreign.id, qty: 1 }] }, ctx);

    expect(outcome).toMatchObject({ ok: false, error: 'unknown_products' });
    expect(db.orders).toHaveLength(0);
  });

  it('refuses when the tenant has no order status of kind=new', async () => {
    const { db, ctx } = setup(ORDERS_ON);
    db.orderStatuses.length = 0;
    const blusa = db.addProduct({ tenant_id: TENANT, name: 'Blusa' });

    const outcome = await createOrder({ items: [{ product_id: blusa.id, qty: 1 }] }, ctx);

    expect(outcome).toMatchObject({ ok: false, error: 'orders_not_configured' });
  });

  /**
   * Regression from the live demo: several messages after check_catalog, the
   * model no longer has the real uuids (tool results do not survive across
   * inbound messages) and invents a slug. The error has to name the fix or it
   * just apologizes to the customer.
   */
  it('tells the model how to recover from a non-uuid product_id', async () => {
    const { ctx } = setup(ORDERS_ON);

    const outcome = await createOrder(
      { items: [{ product_id: 'blusa-lino-manuela', qty: 2 }] },
      ctx,
    );

    expect(outcome).toMatchObject({ ok: false, error: 'invalid_product_id' });
    expect(JSON.stringify(outcome)).toMatch(/call check_catalog/i);
  });

  it('rejects an empty item list', async () => {
    const { ctx } = setup(ORDERS_ON);
    const outcome = await createOrder({ items: [] }, ctx);
    expect(outcome).toMatchObject({ ok: false, error: 'invalid_arguments' });
  });
});

describe('handoff_to_human', () => {
  it('flags attention, pauses indefinitely, and returns the configured message', async () => {
    const { ctx, conversation } = setup({
      escalation: { handoffMessage: 'Ya te contacto una persona del equipo.' },
    });

    const outcome = await handoffToHuman({ reason: 'complaint' }, ctx);

    expect(outcome).toMatchObject({ ok: true, stopLoop: true });
    expect(outcome.ok && outcome.reply).toBe('Ya te contacto una persona del equipo.');
    expect(conversation.needs_attention).toBe(true);
    expect(conversation.bot_paused).toBe(true);
    // Indefinite: a human owns this now, and only a human hands it back.
    expect(conversation.paused_until).toBeNull();
  });

  it('rejects a reason outside the declared enum', async () => {
    const { ctx, conversation } = setup();
    const outcome = await handoffToHuman({ reason: 'porque si' } as unknown as Json, ctx);

    expect(outcome).toMatchObject({ ok: false, error: 'invalid_arguments' });
    expect(conversation.needs_attention).toBe(false);
  });
});
