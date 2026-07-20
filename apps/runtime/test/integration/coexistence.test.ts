/**
 * ws-r1 integration tests (spec §6): echo fixture → owner message + pause;
 * inbound during pause → persisted, no reply, skip turn; inbound after expiry
 * → flag cleared + real reply; echo idempotency. Local Supabase (seeded),
 * FakeModel — no network. Runs via `pnpm db:test`.
 *
 * Uses a dedicated customer number (string-swapped into the fixtures) so it
 * never touches the seeded conversations flow.test.ts asserts against. The
 * swap is value-level find/replace on the raw JSON — no echo-shape paths leak
 * out of envelope.ts.
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
import { FakeModel } from '../../src/model/fake.js';
import { MockWaSender } from '../../src/wa/sender.js';

globalThis.WebSocket ??= WebSocket as unknown as typeof globalThis.WebSocket;

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
// Well-known supabase-demo service_role JWT shipped with `supabase start`. Local only.
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const TENANT_A = 'aa000000-0001-4000-8000-000000000001';
const SEEDED_CUSTOMER_WA_ID = '573015550101';
const TEST_WA_ID = '573015559901'; // dedicated to this file
const HOUR_MS = 3_600_000;

const FIXTURES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/shared/fixtures/360dialog',
);

/** Raw fixture with the customer number and all wamids swapped for test-locals. */
function isolatedFixture(name: string, wamidTag: string): string {
  let raw = readFileSync(resolve(FIXTURES, `${name}.json`), 'utf8');
  raw = raw.replaceAll(SEEDED_CUSTOMER_WA_ID, TEST_WA_ID);
  // Any wamid in the payload becomes a per-tag synthetic id (opaque strings).
  raw = raw.replace(/wamid\.[A-Za-z0-9+/=]+/g, `wamid.r1test.${wamidTag}`);
  return raw;
}

const admin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const db = createDb({ url: SUPABASE_URL, serviceRoleKey: SERVICE_ROLE_KEY });
const model = new FakeModel('Respuesta post-pausa 🤖');
const sender = new MockWaSender();
const deps = { db, model, sender, log: () => {} };
const app = createApp({ db, log: () => {} });

const createdEventIds: string[] = [];

async function post(rawBody: string): Promise<string> {
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
  return eventId;
}

async function drain(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    if ((await drainQueueOnce(deps, { vtSeconds: 2 })) === 0) break;
  }
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

async function testMessages() {
  const conversation = await testConversation();
  if (!conversation) return [];
  const { data, error } = await admin
    .from('messages')
    .select('*')
    .eq('tenant_id', TENANT_A)
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

async function deleteTestRows(): Promise<void> {
  const conversation = await testConversation();
  if (conversation) {
    await admin.from('agent_turns').delete().eq('conversation_id', conversation.id);
    await admin.from('messages').delete().eq('conversation_id', conversation.id);
    await admin.from('conversations').delete().eq('id', conversation.id);
  }
  await admin.from('customers').delete().eq('tenant_id', TENANT_A).eq('wa_id', TEST_WA_ID);
}

beforeAll(async () => {
  await deleteTestRows(); // leftovers from previous local runs
});

afterAll(async () => {
  await deleteTestRows();
  if (createdEventIds.length > 0) {
    await admin.from('webhook_events').delete().in('id', createdEventIds);
  }
});

describe('coexistence: owner echo pauses the bot', () => {
  it('echo fixture → owner message row + bot_paused + paused_until set', async () => {
    const before = Date.now();
    await post(isolatedFixture('echo-owner-reply', 'echo.1'));
    await drain();

    const messages = await testMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.direction).toBe('outbound');
    expect(messages[0]?.source).toBe('owner_app');
    expect(messages[0]?.type).toBe('text');
    expect(messages[0]?.wa_message_id).toBe('wamid.r1test.echo.1');
    expect(messages[0]?.body).toContain('Valentina');

    const conversation = await testConversation();
    expect(conversation?.bot_paused).toBe(true);
    expect(conversation?.paused_until).not.toBeNull();
    // Tenant A's published config: pauseHoursOnOwnerReply = 24.
    const delta = Date.parse(conversation!.paused_until!) - before;
    expect(delta).toBeGreaterThan(23 * HOUR_MS);
    expect(delta).toBeLessThanOrEqual(24 * HOUR_MS + 60_000);
    expect(conversation?.last_message_at).toBe(messages[0]?.created_at);
    expect(conversation?.last_customer_message_at).toBeNull();
    expect(model.calls).toHaveLength(0);
    expect(sender.sent).toHaveLength(0);
  });

  it('same echo delivered again → one row, pause not re-extended', async () => {
    const pausedUntilBefore = (await testConversation())?.paused_until;

    await post(isolatedFixture('echo-owner-reply', 'echo.1'));
    await drain();

    expect(await testMessages()).toHaveLength(1);
    expect((await testConversation())?.paused_until).toBe(pausedUntilBefore);
  });

  it('inbound during pause → persisted, no reply, bot_paused skip turn', async () => {
    await post(isolatedFixture('inbound-text', 'inbound.1'));
    await drain();

    const messages = await testMessages();
    expect(messages).toHaveLength(2);
    const inbound = messages[1];
    expect(inbound?.direction).toBe('inbound');
    expect(inbound?.source).toBe('customer');
    expect(model.calls).toHaveLength(0);
    expect(sender.sent).toHaveLength(0);

    const { data: turns } = await admin
      .from('agent_turns')
      .select('*')
      .eq('message_id', inbound!.id);
    expect(turns).toHaveLength(1);
    expect(turns?.[0]?.model).toBe('none');
    expect(turns?.[0]?.error).toMatchObject({ reason: 'bot_paused' });

    // The pause stands; the customer message still opened the 24h window.
    const conversation = await testConversation();
    expect(conversation?.bot_paused).toBe(true);
    expect(conversation?.last_customer_message_at).toBe(inbound?.created_at);
  });

  it('inbound after expiry → lazy re-arm clears the flag and the bot replies', async () => {
    const conversation = await testConversation();
    await admin
      .from('conversations')
      .update({ paused_until: new Date(Date.now() - 60_000).toISOString() })
      .eq('id', conversation!.id);

    await post(isolatedFixture('inbound-text', 'inbound.2'));
    await drain();

    const after = await testConversation();
    expect(after?.bot_paused).toBe(false);
    expect(after?.paused_until).toBeNull();

    const messages = await testMessages();
    expect(messages).toHaveLength(4); // echo, inbound.1, inbound.2, bot reply
    const reply = messages[3];
    expect(reply?.direction).toBe('outbound');
    expect(reply?.source).toBe('bot');
    expect(reply?.body).toBe('Respuesta post-pausa 🤖');
    expect(model.calls).toHaveLength(1);
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.to).toBe(TEST_WA_ID);

    const { data: turns } = await admin.from('agent_turns').select('*').eq('message_id', reply!.id);
    expect(turns).toHaveLength(1);
    expect(turns?.[0]?.error).toBeNull();
    expect(turns?.[0]?.model).toBe('fake-model');
  });
});
