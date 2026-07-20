/**
 * Integration test (spec §6): boot the app in-process against local Supabase
 * (seeded), POST signed fixtures, drain the worker once, assert rows.
 * FakeModel throughout — no network. Runs via `pnpm db:test` (needs
 * `supabase start` + `supabase db reset` + `pnpm seed:auth`).
 *
 * Test-only exception: this file creates its own service client for row
 * assertions the repository surface deliberately doesn't expose. The
 * import-restriction test scopes the supabase-js ban to src/**.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database, Json } from '@optiax/shared';
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
const FIXTURE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/shared/fixtures/360dialog/inbound-text.json',
);
const FIXTURE_RAW = readFileSync(FIXTURE_PATH, 'utf8');
const FIXTURE_WAMID = (JSON.parse(FIXTURE_RAW) as {
  entry: Array<{ changes: Array<{ value: { messages: Array<{ id: string }> } }> }>;
}).entry[0]!.changes[0]!.value.messages[0]!.id;
const CANNED_REPLY = 'Respuesta integrada de prueba 🤖';

const admin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const db = createDb({ url: SUPABASE_URL, serviceRoleKey: SERVICE_ROLE_KEY });
const model = new FakeModel(CANNED_REPLY);
const sender = new MockWaSender();
const deps = { db, model, sender, log: () => {} };
const app = createApp({ db, log: () => {} });

const createdEventIds: string[] = [];
const createdMessageIds: string[] = [];

async function post(rawBody: string, signature?: string): Promise<Response> {
  return app.request('/webhooks/wa', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [WEBHOOK_SIGNATURE_HEADER]: signature ?? signWebhookPayload(rawBody),
    },
    body: rawBody,
  });
}

async function drain(): Promise<number> {
  let total = 0;
  for (let i = 0; i < 10; i++) {
    const handled = await drainQueueOnce(deps, { vtSeconds: 2 });
    if (handled === 0) break;
    total += handled;
  }
  return total;
}

async function purgeQueue(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const batch = await db.queue.read(100, 1);
    if (batch.length === 0) return;
    for (const message of batch) await db.queue.archive(message.msgId);
  }
}

async function conversationMessages() {
  const { data, error } = await admin
    .from('messages')
    .select('*')
    .eq('tenant_id', TENANT_A)
    .eq('conversation_id', 'aa000000-0030-4000-8000-000000000001')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

beforeAll(async () => {
  await purgeQueue();
  // Remove leftovers from previous local runs so counts are deterministic.
  const { data: stale } = await admin
    .from('messages')
    .select('id')
    .eq('tenant_id', TENANT_A)
    .or(`wa_message_id.eq.${FIXTURE_WAMID},body.eq.${CANNED_REPLY}`);
  const staleIds = (stale ?? []).map((m) => m.id);
  if (staleIds.length > 0) {
    await admin.from('agent_turns').delete().in('message_id', staleIds);
    await admin.from('messages').delete().in('id', staleIds);
  }
});

afterAll(async () => {
  if (createdMessageIds.length > 0) {
    await admin.from('agent_turns').delete().in('message_id', createdMessageIds);
    await admin.from('messages').delete().in('id', createdMessageIds);
  }
  if (createdEventIds.length > 0) {
    await admin.from('webhook_events').delete().in('id', createdEventIds);
  }
});

describe('walking skeleton: webhook → queue → worker → rows', () => {
  it('GET /health responds with a version', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; version: string };
    expect(body.ok).toBe(true);
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('invalid signature → 401 and nothing stored', async () => {
    const { count: before } = await admin
      .from('webhook_events')
      .select('*', { count: 'exact', head: true });
    const res = await post(FIXTURE_RAW, 'deadbeef');
    expect(res.status).toBe(401);
    const { count: after } = await admin
      .from('webhook_events')
      .select('*', { count: 'exact', head: true });
    expect(after).toBe(before);
  });

  it('signed inbound-text → event logged, queued, processed: inbound + reply + agent_turn', async () => {
    const messagesBefore = await conversationMessages();

    const res = await post(FIXTURE_RAW);
    expect(res.status).toBe(200);
    const { eventId } = (await res.json()) as { eventId: string };
    createdEventIds.push(eventId);

    const event = await db.webhookEvents.get(eventId);
    expect(event?.tenant_id).toBe(TENANT_A);
    expect(event?.processed_at).toBeNull();

    const handled = await drain();
    expect(handled).toBeGreaterThanOrEqual(1);

    const processed = await db.webhookEvents.get(eventId);
    expect(processed?.processed_at).not.toBeNull();
    expect(processed?.error).toBeNull();

    const messagesAfter = await conversationMessages();
    const newMessages = messagesAfter.slice(messagesBefore.length);
    createdMessageIds.push(...newMessages.map((m) => m.id));
    expect(newMessages).toHaveLength(2);

    const [inbound, outbound] = newMessages;
    expect(inbound?.wa_message_id).toBe(FIXTURE_WAMID);
    expect(inbound?.direction).toBe('inbound');
    expect(inbound?.source).toBe('customer');
    expect(outbound?.direction).toBe('outbound');
    expect(outbound?.source).toBe('bot');
    expect(outbound?.body).toBe(CANNED_REPLY);
    expect(outbound?.wa_status).toBe('accepted');
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.to).toBe('573015550101');

    const { data: turns } = await admin
      .from('agent_turns')
      .select('*')
      .eq('message_id', outbound!.id);
    expect(turns).toHaveLength(1);
    expect(turns?.[0]?.model).toBe('fake-model');

    const { data: tenant } = await admin
      .from('tenants')
      .select('active_prompt_version_id')
      .eq('id', TENANT_A)
      .single();
    expect(turns?.[0]?.prompt_version_id).toBe(tenant?.active_prompt_version_id);

    const { data: conversation } = await admin
      .from('conversations')
      .select('last_message_at, last_customer_message_at')
      .eq('id', 'aa000000-0030-4000-8000-000000000001')
      .single();
    expect(conversation?.last_customer_message_at).toBe(inbound?.created_at);
    expect(conversation?.last_message_at).toBe(outbound?.created_at);
  });

  it('same fixture POSTed again → no duplicates, no second reply', async () => {
    const messagesBefore = await conversationMessages();

    const res = await post(FIXTURE_RAW);
    expect(res.status).toBe(200);
    const { eventId } = (await res.json()) as { eventId: string };
    createdEventIds.push(eventId);

    await drain();

    const messagesAfter = await conversationMessages();
    expect(messagesAfter).toHaveLength(messagesBefore.length);
    expect(model.calls).toHaveLength(1);
    expect(sender.sent).toHaveLength(1);
    expect((await db.webhookEvents.get(eventId))?.processed_at).not.toBeNull();
  });

  it('unknown phone_number_id → event logged with error, queue drains, no crash', async () => {
    const payload = JSON.parse(FIXTURE_RAW) as {
      entry: Array<{ changes: Array<{ value: { metadata: { phone_number_id: string } } }> }>;
    };
    payload.entry[0]!.changes[0]!.value.metadata.phone_number_id = '999000999000999';
    const raw = JSON.stringify(payload as unknown as Json);

    const res = await post(raw);
    expect(res.status).toBe(200);
    const { eventId } = (await res.json()) as { eventId: string };
    createdEventIds.push(eventId);

    const handled = await drain();
    expect(handled).toBeGreaterThanOrEqual(1);

    const event = await db.webhookEvents.get(eventId);
    expect(event?.tenant_id).toBeNull();
    expect(event?.processed_at).toBeNull();
    expect(event?.error).toMatchObject({ reason: 'unknown_phone_number_id' });

    expect(await db.queue.read(10, 1)).toEqual([]);
  });
});
