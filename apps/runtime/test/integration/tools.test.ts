/**
 * ws-r2 integration tests (spec §6) against local Supabase: a scripted
 * FakeModel conversation that checks the catalog, captures the customer and
 * creates a two-line order, asserted against real rows.
 *
 * The point of doing this against Postgres rather than the FakeDb is the parts
 * the fake can only imitate: the D2 `total_spent` trigger firing on a
 * service-role insert, `sort_order` actually persisting, and RLS/grants not
 * quietly blocking the agent's writes.
 *
 * Test-only exception: creates its own service client for assertions
 * (import-restriction ban is scoped to src/**).
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@optiax/shared';
import { signWebhookPayload, WEBHOOK_SIGNATURE_HEADER } from '@optiax/shared/webhook';
import { createDb } from '../../src/db/index.js';
import { createApp } from '../../src/app.js';
import { drainQueueOnce } from '../../src/worker/worker.js';
import { FakeModel, textTurn, toolCallTurn, type ScriptedTurn } from '../../src/model/fake.js';
import { MockWaSender } from '../../src/wa/sender.js';

globalThis.WebSocket ??= WebSocket as unknown as typeof globalThis.WebSocket;

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const TENANT_A = 'aa000000-0001-4000-8000-000000000001';
const SEEDED_CUSTOMER_WA_ID = '573015550101';
const TEST_WA_ID = '573015559902'; // dedicated to this file

const FIXTURES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/shared/fixtures/360dialog',
);

function isolatedFixture(name: string, wamidTag: string): string {
  let raw = readFileSync(resolve(FIXTURES, `${name}.json`), 'utf8');
  raw = raw.replaceAll(SEEDED_CUSTOMER_WA_ID, TEST_WA_ID);
  raw = raw.replace(/wamid\.[A-Za-z0-9+/=]+/g, `wamid.r2test.${wamidTag}`);
  return raw;
}

const admin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const db = createDb({ url: SUPABASE_URL, serviceRoleKey: SERVICE_ROLE_KEY });
const sender = new MockWaSender();
const app = createApp({ db, log: () => {} });

const createdEventIds: string[] = [];

async function post(rawBody: string): Promise<void> {
  const res = await app.request('/webhooks/wa', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [WEBHOOK_SIGNATURE_HEADER]: signWebhookPayload(rawBody),
    },
    body: rawBody,
  });
  expect(res.status).toBe(200);
  const { eventId } = (await res.json()) as { eventId: string };
  createdEventIds.push(eventId);
}

/** Drive one inbound message all the way through with a scripted model. */
async function runWithScript(script: ScriptedTurn[], wamidTag: string): Promise<FakeModel> {
  const model = new FakeModel('Respuesta de respaldo.', script);
  await post(isolatedFixture('inbound-text', wamidTag));
  for (let i = 0; i < 10; i++) {
    if ((await drainQueueOnce({ db, model, sender, log: () => {} }, { vtSeconds: 2 })) === 0) break;
  }
  return model;
}

async function testConversation() {
  const { data, error } = await admin
    .from('conversations')
    .select('*')
    .eq('tenant_id', TENANT_A)
    .eq('wa_id', TEST_WA_ID)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function testCustomer() {
  const { data, error } = await admin
    .from('customers')
    .select('*')
    .eq('tenant_id', TENANT_A)
    .eq('wa_id', TEST_WA_ID)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function seededProducts() {
  const { data, error } = await admin
    .from('products')
    .select('*')
    .eq('tenant_id', TENANT_A)
    .eq('available', true)
    .order('name')
    .limit(2);
  if (error) throw error;
  if (!data || data.length < 2) throw new Error('seed must provide two available products');
  return data;
}

async function deleteTestRows(): Promise<void> {
  const conversation = await testConversation();
  const customer = await testCustomer();
  if (customer) {
    const { data: orders } = await admin
      .from('orders')
      .select('id')
      .eq('tenant_id', TENANT_A)
      .eq('customer_id', customer.id);
    for (const order of orders ?? []) {
      await admin.from('order_items').delete().eq('order_id', order.id);
      await admin.from('orders').delete().eq('id', order.id);
    }
  }
  if (conversation) {
    await admin.from('agent_turns').delete().eq('conversation_id', conversation.id);
    await admin.from('messages').delete().eq('conversation_id', conversation.id);
    await admin.from('conversations').delete().eq('id', conversation.id);
  }
  await admin.from('customers').delete().eq('tenant_id', TENANT_A).eq('wa_id', TEST_WA_ID);
}

beforeAll(async () => {
  await deleteTestRows();
});

afterAll(async () => {
  await deleteTestRows();
  if (createdEventIds.length > 0) {
    await admin.from('webhook_events').delete().in('id', createdEventIds);
  }
});

describe('agent tools against real Postgres', () => {
  it('catalog → capture → 2-line order, with real rows, sort_order and total_spent', async () => {
    const [first, second] = await seededProducts();

    const model = await runWithScript(
      [
        toolCallTurn({ name: 'check_catalog', args: { query: 'blusa' } }),
        toolCallTurn({ name: 'capture_customer', args: { name: 'Ana Integración', city: 'Bogotá' } }),
        toolCallTurn({
          name: 'create_order',
          args: {
            items: [
              { product_id: first!.id, qty: 2 },
              { product_id: second!.id, qty: 1 },
            ],
            confirmed: true,
            delivery_address: 'Cl 100 #15-20',
          },
        }),
        textTurn('¡Listo Ana! Tu pedido quedó registrado. 🎉'),
      ],
      'flow.1',
    );

    expect(model.roundsRun).toBe(4);

    // The catalog tool saw real seeded products.
    const catalogResult = JSON.stringify(model.calls[1]?.toolTurns);
    expect(catalogResult).toContain('product_id');

    const customer = await testCustomer();
    expect(customer).toMatchObject({ name: 'Ana Integración', city: 'Bogotá' });
    // getOrCreateConversation created this row before the agent ran, so the
    // capture must have updated it rather than adding a second.
    expect(customer?.source).toBe('agent');

    const conversation = await testConversation();
    const { data: orders } = await admin
      .from('orders')
      .select('*')
      .eq('tenant_id', TENANT_A)
      .eq('customer_id', customer!.id);
    expect(orders).toHaveLength(1);

    const order = orders![0]!;
    // Priced the way the executor prices: promo when set, otherwise list.
    const effective = (p: { price: number; promo_price: number | null }) =>
      Number(p.promo_price ?? p.price);
    const expectedTotal = 2 * effective(first!) + effective(second!);
    expect(Number(order.total)).toBe(expectedTotal);
    expect(order.source).toBe('agent');
    expect(order.conversation_id).toBe(conversation!.id);
    expect(order.delivery_address).toBe('Cl 100 #15-20');
    expect(order.currency).toBe('COP');

    // Initial status is the tenant's kind='new'.
    const { data: status } = await admin
      .from('order_statuses')
      .select('kind')
      .eq('id', order.status_id)
      .single();
    expect(status?.kind).toBe('new');

    // sort_order persists in the order the customer asked for the lines.
    const { data: items } = await admin
      .from('order_items')
      .select('*')
      .eq('order_id', order.id)
      .order('sort_order');
    expect(items).toHaveLength(2);
    expect(items!.map((i) => i.sort_order)).toEqual([0, 1]);
    expect(items![0]).toMatchObject({ description: first!.name, qty: 2 });
    expect(Number(items![0]!.unit_price)).toBe(effective(first!));

    // The D2 trigger fired on a service-role insert — the thing the fake can
    // only imitate.
    const refreshed = await testCustomer();
    expect(Number(refreshed?.total_spent)).toBe(expectedTotal);
    expect(refreshed?.last_order_at).not.toBeNull();

    // One agent_turn per model round, tool_calls populated.
    const { data: turns } = await admin
      .from('agent_turns')
      .select('*')
      .eq('conversation_id', conversation!.id)
      .order('created_at');
    expect(turns).toHaveLength(4);
    expect(JSON.stringify(turns![0]!.tool_calls)).toContain('check_catalog');
    expect(JSON.stringify(turns![2]!.tool_calls)).toContain('create_order');
    expect(turns![3]!.tool_calls).toEqual([]);
    expect(turns![3]!.message_id).not.toBeNull();
  });

  it('handoff sets needs_attention and pauses the conversation indefinitely', async () => {
    await runWithScript(
      [toolCallTurn({ name: 'handoff_to_human', args: { reason: 'complaint' } })],
      'handoff.1',
    );

    const conversation = await testConversation();
    expect(conversation?.needs_attention).toBe(true);
    expect(conversation?.bot_paused).toBe(true);
    expect(conversation?.paused_until).toBeNull();
  });

  it('a product id from another tenant is refused, not silently ordered', async () => {
    // The handoff above paused this conversation indefinitely and that is the
    // point of it — a paused bot must not run tools. Lift the pause the way a
    // human would from the dashboard, so this test exercises the tool rather
    // than the pause guard.
    const paused = await testConversation();
    await admin
      .from('conversations')
      .update({ bot_paused: false, paused_until: null, needs_attention: false })
      .eq('id', paused!.id);

    const { data: foreign } = await admin
      .from('products')
      .select('id')
      .neq('tenant_id', TENANT_A)
      .limit(1)
      .single();

    const existing = await testCustomer();
    const { count: ordersBefore } = await admin
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', TENANT_A)
      .eq('customer_id', existing!.id);

    const model = await runWithScript(
      [
        toolCallTurn({
          name: 'create_order',
          args: { items: [{ product_id: foreign!.id, qty: 1 }], confirmed: true },
        }),
        textTurn('No encontré ese producto, ¿me lo confirmas?'),
      ],
      'crosstenant.1',
    );

    // The model was told the ids are unknown, and no order exists.
    expect(JSON.stringify(model.calls[1]?.toolTurns)).toContain('unknown_products');

    // No NEW order: the earlier test's order is still there by design (this
    // file cleans up once, at the end).
    const { count: ordersAfter } = await admin
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', TENANT_A)
      .eq('customer_id', existing!.id);
    expect(ordersAfter).toBe(ordersBefore);
  });
});
