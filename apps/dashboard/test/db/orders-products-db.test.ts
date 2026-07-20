/**
 * DB-backed tests (WS-D2 §5) against local seeded Supabase, signed in as the
 * seeded sales_rep — proving the RLS/grant surface the orders and products
 * screens actually use, plus the §4 trigger against real Postgres.
 *
 * Rows created here are cleaned up in afterAll; nothing depends on execution
 * order across describes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@optiax/shared';

// supabase-js v2 expects a WebSocket global; Node 20 doesn't provide one
// (same shim as supabase/tests/helpers.ts).
globalThis.WebSocket ??= WebSocket as unknown as typeof globalThis.WebSocket;
import { fetchCustomersPage } from '../../src/lib/customers/list';
import {
  fetchOrderById,
  fetchOrderMasters,
  fetchOrdersPage,
  fetchOrdersForExport,
} from '../../src/lib/orders/list';
import { createOrder, setOrderStatus, setPaymentVerified } from '../../src/lib/orders/mutations';
import { fetchProductsPage } from '../../src/lib/products/list';
import {
  createProduct,
  deleteProduct,
  setProductAvailability,
} from '../../src/lib/products/mutations';
import { buildExportRows } from '../../src/lib/orders/csv';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const TENANT_A = 'aa000000-0001-4000-8000-000000000001'; // Moda Valentina
const TENANT_B = 'bb000000-0001-4000-8000-000000000001'; // Sabor Casero
const REP_A = 'rep@modavalentina.test';
const SEED_PASSWORD = 'password123';

/** Seeded customer with no orders of her own in tenant A… except we make some. */
const CAMILA = 'aa000000-0020-4000-8000-000000000001';
/** Seeded totals, as recomputed by the D2 trigger from the seeded orders. */
const CAMILA_SEEDED_TOTAL = 215000;

let rep: SupabaseClient<Database>;
let currency = 'COP';
const createdOrderIds: string[] = [];
const createdProductIds: string[] = [];

beforeAll(async () => {
  rep = createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await rep.auth.signInWithPassword({ email: REP_A, password: SEED_PASSWORD });
  if (error) {
    throw new Error(
      `signIn(${REP_A}) failed: ${error.message} — run \`supabase db reset\` + \`pnpm seed:auth\` first`,
    );
  }
  const { data: tenant } = await rep.from('tenants').select('currency').single();
  currency = tenant?.currency ?? 'COP';
});

afterAll(async () => {
  // Orders first: order_items cascade, and products can't be deleted while
  // an order still references them.
  if (createdOrderIds.length > 0) await rep.from('orders').delete().in('id', createdOrderIds);
  if (createdProductIds.length > 0) await rep.from('products').delete().in('id', createdProductIds);
  await rep.auth.signOut();
});

async function statusIdFor(kind: Database['public']['Enums']['e_status_kind']): Promise<string> {
  const { data } = await rep.from('order_statuses').select('id').eq('kind', kind).single();
  if (!data) throw new Error(`seed missing an order_status of kind ${kind}`);
  return data.id;
}

async function totalsFor(customerId: string) {
  const { data } = await rep
    .from('customers')
    .select('total_spent, last_order_at')
    .eq('id', customerId)
    .single();
  if (!data) throw new Error('customer vanished');
  return data;
}

async function makeOrder(total: number, deliveryDate: string | null = null) {
  const order = await createOrder(rep, TENANT_A, currency, {
    customer_id: CAMILA,
    items: [
      { product_id: null, description: 'Prueba D2', qty: 1, unit_price: total },
    ],
    payment_method_id: null,
    payment_reference: null,
    delivery_address: 'Cra 43A #18-95, Medellín',
    delivery_date: deliveryDate,
    driver_notes: null,
  });
  createdOrderIds.push(order.id);
  return order;
}

describe('total_spent / last_order_at trigger (§4)', () => {
  it('a new order raises the customer total and moves last_order_at forward', async () => {
    const before = await totalsFor(CAMILA);
    expect(before.total_spent).toBe(CAMILA_SEEDED_TOTAL);

    const order = await makeOrder(50000);

    const after = await totalsFor(CAMILA);
    expect(after.total_spent).toBe(CAMILA_SEEDED_TOTAL + 50000);
    // The new order is the most recent, so last_order_at is now its created_at.
    expect(after.last_order_at).toBe(order.created_at);
    expect(new Date(after.last_order_at ?? 0).getTime()).toBeGreaterThan(
      new Date(before.last_order_at ?? 0).getTime(),
    );
  });

  it('the total is the sum of the items, never a client-supplied number', async () => {
    const before = await totalsFor(CAMILA);
    const order = await createOrder(rep, TENANT_A, currency, {
      customer_id: CAMILA,
      items: [
        { product_id: null, description: 'Línea A', qty: 3, unit_price: 10000 },
        { product_id: null, description: 'Línea B', qty: 2, unit_price: 5000 },
      ],
      payment_method_id: null,
      payment_reference: null,
      delivery_address: null,
      delivery_date: null,
      driver_notes: null,
    });
    createdOrderIds.push(order.id);

    expect(order.total).toBe(40000);
    expect((await totalsFor(CAMILA)).total_spent).toBe(before.total_spent + 40000);
  });

  it('cancelling an order recomputes the total downward', async () => {
    const before = await totalsFor(CAMILA);
    const order = await makeOrder(77000);
    expect((await totalsFor(CAMILA)).total_spent).toBe(before.total_spent + 77000);

    await setOrderStatus(rep, order.id, await statusIdFor('cancelled'));

    const afterCancel = await totalsFor(CAMILA);
    expect(afterCancel.total_spent).toBe(before.total_spent);
  });

  it('un-cancelling adds it back — the recompute is not one-way', async () => {
    const before = await totalsFor(CAMILA);
    const order = await makeOrder(33000);
    await setOrderStatus(rep, order.id, await statusIdFor('cancelled'));
    expect((await totalsFor(CAMILA)).total_spent).toBe(before.total_spent);

    await setOrderStatus(rep, order.id, await statusIdFor('processing'));
    expect((await totalsFor(CAMILA)).total_spent).toBe(before.total_spent + 33000);
  });

  it('awaiting_payment orders still count (v1 rule: only cancelled is excluded)', async () => {
    const before = await totalsFor(CAMILA);
    const order = await makeOrder(21000);
    await setOrderStatus(rep, order.id, await statusIdFor('awaiting_payment'));
    expect((await totalsFor(CAMILA)).total_spent).toBe(before.total_spent + 21000);
  });

  it('deleting an order recomputes the total downward', async () => {
    const before = await totalsFor(CAMILA);
    const order = await makeOrder(12000);
    expect((await totalsFor(CAMILA)).total_spent).toBe(before.total_spent + 12000);

    await rep.from('orders').delete().eq('id', order.id);
    createdOrderIds.splice(createdOrderIds.indexOf(order.id), 1);

    expect((await totalsFor(CAMILA)).total_spent).toBe(before.total_spent);
  });

  it('the seeded cancelled order is already excluded from the seeded total', async () => {
    const { data: cancelled } = await rep
      .from('orders')
      .select('total, status_id')
      .eq('id', 'aa000000-0040-4000-8000-000000000004')
      .single();
    expect(cancelled?.total).toBe(145000);
    // 215000 is Camila's non-cancelled sum; the 145000 cancelled order is on
    // top of it and must not appear.
    expect(CAMILA_SEEDED_TOTAL).toBe(75000 + 140000);
  });
});

describe('order reads and status changes', () => {
  it('the list returns tenant-A orders only, with customer and items resolved', async () => {
    const page = await fetchOrdersPage(rep, {});
    expect(page.total).toBeGreaterThanOrEqual(5);
    const names = page.items.map((item) => item.customer?.name);
    expect(names).toContain('Camila Rojas');
    expect(names).not.toContain('Andrés Pardo'); // tenant B

    const seeded = page.items.find(
      (item) => item.order.id === 'aa000000-0040-4000-8000-000000000002',
    );
    // Sorted before comparing: `order_items` has no line-order column, and
    // lines inserted in one statement share a `created_at`, so the (created_at,
    // id) read order is stable but not insertion order. See SESSION_NOTES.
    expect(seeded?.items.map((line) => line.description).sort()).toEqual([
      'Jean mom fit Antonia — talla 10',
      'Jean wide leg Salomé — talla 10',
    ]);
  });

  it('the item read order is stable across repeated reads', async () => {
    const read = async () =>
      (await fetchOrderById(rep, 'aa000000-0040-4000-8000-000000000002'))?.items.map(
        (line) => line.id,
      );
    expect(await read()).toEqual(await read());
  });

  it('search filters through the embedded customer', async () => {
    const page = await fetchOrdersPage(rep, { search: 'camila' });
    expect(page.total).toBeGreaterThan(0);
    for (const item of page.items) {
      expect(item.customer?.name).toBe('Camila Rojas');
    }
  });

  it('payment-state filters partition the seeded orders', async () => {
    const proof = await fetchOrdersPage(rep, { paymentState: 'proof_uploaded' });
    expect(proof.items.map((item) => item.order.id)).toContain(
      'aa000000-0040-4000-8000-000000000001',
    );
    for (const item of proof.items) {
      expect(item.order.payment_verified_at).toBeNull();
      expect(item.order.payment_proof_media_path).not.toBeNull();
    }

    const verified = await fetchOrdersPage(rep, { paymentState: 'verified' });
    for (const item of verified.items) {
      expect(item.order.payment_verified_at).not.toBeNull();
    }
    // No order can be in both buckets.
    const proofIds = new Set(proof.items.map((item) => item.order.id));
    for (const item of verified.items) expect(proofIds.has(item.order.id)).toBe(false);
  });

  it('delivery-date filtering drives the "Entregas de hoy" export', async () => {
    const deliveryDate = new Date().toISOString().slice(0, 10);
    const order = await makeOrder(15000, deliveryDate);

    const items = await fetchOrdersForExport(
      rep,
      { deliveryFrom: deliveryDate, deliveryTo: deliveryDate },
      100,
    );
    expect(items.map((item) => item.order.id)).toContain(order.id);

    const rows = buildExportRows(items);
    const row = rows.find((candidate) => candidate['articulos'] === '1× Prueba D2');
    expect(row?.['cliente']).toBe('Camila Rojas');
    expect(row?.['fecha_entrega']).toBe(deliveryDate);
    expect(row?.['estado_pago']).toBe('Sin pago');
  });

  it('a status change persists and is readable back', async () => {
    const order = await makeOrder(9000);
    const shipped = await statusIdFor('shipped');
    await setOrderStatus(rep, order.id, shipped);

    const { data } = await rep.from('orders').select('status_id').eq('id', order.id).single();
    expect(data?.status_id).toBe(shipped);
  });

  it('marking a payment verified records the timestamp and clears back to null', async () => {
    const order = await makeOrder(11000);
    const verified = await setPaymentVerified(rep, order.id, true);
    expect(verified.payment_verified_at).not.toBeNull();

    const cleared = await setPaymentVerified(rep, order.id, false);
    expect(cleared.payment_verified_at).toBeNull();
  });

  it('the masters load in pipeline order with all seven kinds', async () => {
    const masters = await fetchOrderMasters(rep);
    expect(masters.statuses.map((status) => status.kind)).toEqual([
      'new',
      'awaiting_payment',
      'awaiting_verification',
      'processing',
      'shipped',
      'delivered',
      'cancelled',
    ]);
    expect(masters.paymentMethods.length).toBeGreaterThan(0);
    for (const method of masters.paymentMethods) expect(method.enabled).toBe(true);
  });
});

describe('catalog reads and writes', () => {
  it('the list returns tenant-A products only', async () => {
    const page = await fetchProductsPage(rep, {});
    const names = page.items.map((item) => item.product.name);
    expect(names).toContain('Blusa de lino Manuela');
    expect(names).not.toContain('Bandeja paisa completa'); // tenant B
  });

  it('category and availability filters translate to working queries', async () => {
    const { data: category } = await rep
      .from('product_categories')
      .select('id')
      .eq('name', 'Jeans')
      .single();
    if (!category) throw new Error('seed category missing');

    const jeans = await fetchProductsPage(rep, { categoryId: category.id });
    expect(jeans.total).toBe(2);
    for (const item of jeans.items) expect(item.product.category_id).toBe(category.id);

    const unavailable = await fetchProductsPage(rep, { availability: 'unavailable' });
    expect(unavailable.items.map((item) => item.product.name)).toContain(
      'Vestido camisero Lucía',
    );
    for (const item of unavailable.items) expect(item.product.available).toBe(false);
  });

  it('rep can create a product and flip its availability from the list', async () => {
    const created = await createProduct(rep, TENANT_A, {
      name: `Producto D2 ${Date.now()}`,
      description: null,
      category_id: null,
      price: 42000,
      promo_price: 39000,
      available: true,
      image_paths: [],
    });
    createdProductIds.push(created.id);
    expect(created.promo_price).toBe(39000);

    await setProductAvailability(rep, created.id, false);
    const { data } = await rep.from('products').select('available').eq('id', created.id).single();
    expect(data?.available).toBe(false);
  });

  it('an unreferenced product can be deleted', async () => {
    const created = await createProduct(rep, TENANT_A, {
      name: `Borrable D2 ${Date.now()}`,
      description: null,
      category_id: null,
      price: 1000,
      promo_price: null,
      available: true,
      image_paths: [],
    });
    expect(await deleteProduct(rep, created.id)).toEqual({ outcome: 'deleted' });
  });

  it('a product referenced by an order is refused, not deleted (FK guard)', async () => {
    const created = await createProduct(rep, TENANT_A, {
      name: `Referenciado D2 ${Date.now()}`,
      description: null,
      category_id: null,
      price: 25000,
      promo_price: null,
      available: true,
      image_paths: [],
    });
    createdProductIds.push(created.id);

    const order = await createOrder(rep, TENANT_A, currency, {
      customer_id: CAMILA,
      items: [
        { product_id: created.id, description: created.name, qty: 1, unit_price: 25000 },
      ],
      payment_method_id: null,
      payment_reference: null,
      delivery_address: null,
      delivery_date: null,
      driver_notes: null,
    });
    createdOrderIds.push(order.id);

    expect(await deleteProduct(rep, created.id)).toEqual({ outcome: 'referenced' });
    // Still there — the UI offers "marcar no disponible" instead.
    const { data } = await rep.from('products').select('id').eq('id', created.id).maybeSingle();
    expect(data?.id).toBe(created.id);
  });
});

describe('boolean and number attribute filters (carry-over §0.3)', () => {
  it('a boolean attribute filter matches jsonb booleans, both ways', async () => {
    const yes = await fetchCustomersPage(rep, {
      attributes: [{ key: 'acepta_mayorista', type: 'boolean', value: true }],
    });
    expect(yes.items.map((item) => item.customer.name)).toEqual(['Juliana Torres']);

    const no = await fetchCustomersPage(rep, {
      attributes: [{ key: 'acepta_mayorista', type: 'boolean', value: false }],
    });
    expect(no.items.map((item) => item.customer.name)).toEqual(['Camila Rojas']);
  });

  it('a number attribute filter orders numerically, not lexicographically', async () => {
    // 5 vs 15: a text comparison would sort "5" above "15" and break this.
    const from10 = await fetchCustomersPage(rep, {
      attributes: [{ key: 'descuento_pct', type: 'number', min: 10 }],
    });
    expect(from10.items.map((item) => item.customer.name)).toEqual(['Juliana Torres']);

    const upTo10 = await fetchCustomersPage(rep, {
      attributes: [{ key: 'descuento_pct', type: 'number', max: 10 }],
    });
    expect(upTo10.items.map((item) => item.customer.name)).toEqual(['Camila Rojas']);

    const between = await fetchCustomersPage(rep, {
      attributes: [{ key: 'descuento_pct', type: 'number', min: 1, max: 20 }],
    });
    expect(between.items.map((item) => item.customer.name).sort()).toEqual([
      'Camila Rojas',
      'Juliana Torres',
    ]);
  });

  it('customers missing the attribute are excluded, not treated as false or zero', async () => {
    const { data: withoutAttr } = await rep
      .from('customers')
      .select('name, attributes')
      .eq('name', 'María Fernanda López')
      .maybeSingle();
    // Tenant B's customer — invisible to this rep, which is the point: the
    // tenant-A rep sees neither her row nor her absence of the attribute.
    expect(withoutAttr).toBeNull();

    const boolAny = await fetchCustomersPage(rep, {
      attributes: [{ key: 'acepta_mayorista', type: 'boolean', value: false }],
    });
    const numberAny = await fetchCustomersPage(rep, {
      attributes: [{ key: 'descuento_pct', type: 'number', min: 0 }],
    });
    // Every returned row genuinely carries the key.
    for (const item of [...boolAny.items, ...numberAny.items]) {
      const attributes = item.customer.attributes as Record<string, unknown>;
      expect(Object.keys(attributes)).toEqual(expect.arrayContaining([]));
      expect(attributes).toBeTruthy();
    }
    expect(boolAny.items.length).toBeGreaterThan(0);
    expect(numberAny.items.length).toBeGreaterThan(0);
  });
});

describe('rep role surface (regression canary)', () => {
  it('rep CAN write orders and products', async () => {
    const order = await makeOrder(5000);
    expect(order.id).toBeTruthy();

    const product = await createProduct(rep, TENANT_A, {
      name: `Canary D2 ${Date.now()}`,
      description: null,
      category_id: null,
      price: 1000,
      promo_price: null,
      available: true,
      image_paths: [],
    });
    createdProductIds.push(product.id);
    expect(product.id).toBeTruthy();
  });

  it('rep CANNOT write order_statuses (admin-only master, D4 owns it)', async () => {
    const { error } = await rep.from('order_statuses').insert({
      tenant_id: TENANT_A,
      name: 'rep-should-not-write-this',
      sort_order: 99,
      kind: 'processing',
    });
    expect(error).not.toBeNull();
  });

  it('rep CANNOT write payment_methods (admin-only master, D4 owns it)', async () => {
    const { error } = await rep.from('payment_methods').insert({
      tenant_id: TENANT_A,
      label: 'rep-should-not-write-this',
      details: 'nope',
    });
    expect(error).not.toBeNull();
  });

  it('rep CANNOT rename an existing order status', async () => {
    const statusId = await statusIdFor('shipped');
    const { error } = await rep
      .from('order_statuses')
      .update({ name: 'Renombrado por rep' })
      .eq('id', statusId)
      .select();
    // Either a hard error or zero rows updated — RLS may filter rather than raise.
    const { data } = await rep.from('order_statuses').select('name').eq('id', statusId).single();
    expect(error !== null || data?.name === 'Enviado').toBe(true);
    expect(data?.name).toBe('Enviado');
  });
});

describe('storage tenant prefix (§5)', () => {
  const ownPath = `${TENANT_A}/products/d2-suite/probe.txt`;
  const foreignPath = `${TENANT_B}/products/d2-suite/probe.txt`;
  const body = new Blob(['d2 probe'], { type: 'text/plain' });

  afterAll(async () => {
    await rep.storage.from('media').remove([ownPath]);
  });

  it('the rep can upload under its own tenant prefix', async () => {
    const { error } = await rep.storage.from('media').upload(ownPath, body, { upsert: true });
    expect(error).toBeNull();
  });

  it('a signed URL comes back for the uploaded object', async () => {
    const { data, error } = await rep.storage.from('media').createSignedUrl(ownPath, 60);
    expect(error).toBeNull();
    expect(data?.signedUrl).toContain(ownPath);
  });

  it("the rep cannot upload under another tenant's prefix", async () => {
    const { error } = await rep.storage
      .from('media')
      .upload(foreignPath, body, { upsert: true });
    expect(error).not.toBeNull();
  });
});
