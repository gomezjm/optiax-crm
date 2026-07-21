/**
 * Publish + Playground endpoints against local Supabase (ws-d3 §7). Boots the
 * app in-process with the REAL db, the REAL Supabase-JWT authenticator, and the
 * deterministic eval layer (no Gemini). Proves:
 *   - auth: a request with no/invalid token is rejected; the tenant comes from
 *     the token, never the body.
 *   - the gate blocks a broken draft (pointer untouched) and a good draft flips
 *     the active pointer atomically to a fresh prompt_versions row.
 *   - the Playground persists nothing.
 *
 * Uses TENANT_B (Sabor Casero) so it never disturbs the TENANT_A fixtures the
 * other integration files assert on, and restores TENANT_B's pointer + published
 * config in afterAll. Runs via `pnpm db:test`.
 *
 * Test-only exception: creates its own service + anon clients for setup and row
 * assertions the repository surface deliberately doesn't expose.
 */
import { WebSocket } from 'ws';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database, Json } from '@optiax/shared';
import { FOOD_CONFIG } from '@optiax/shared/evals';
import { createDb, createSupabaseAuthenticator } from '../../src/db/index.js';
import { createApp } from '../../src/app.js';
import { FakeModel, textTurn, toolCallTurn } from '../../src/model/fake.js';
import type { AgentModel } from '../../src/model/types.js';
import { deterministicOptions } from '../../src/evals/evaluate.js';

globalThis.WebSocket ??= WebSocket as unknown as typeof globalThis.WebSocket;

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SEED_PASSWORD = 'password123';

const TENANT_B = 'bb000000-0001-4000-8000-000000000001';

const admin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const db = createDb({ url: SUPABASE_URL, serviceRoleKey: SERVICE_ROLE_KEY });
const authenticator = createSupabaseAuthenticator({ url: SUPABASE_URL, serviceRoleKey: SERVICE_ROLE_KEY });

// A swappable proxy: each test sets `innerModel` to script the loop it needs.
let innerModel: AgentModel = new FakeModel('Hola 👋');
const playgroundModel: AgentModel = { generateReply: (input) => innerModel.generateReply(input) };

const app = createApp({
  db,
  log: () => {},
  api: {
    db,
    authenticator,
    playgroundModel,
    evaluateOptions: deterministicOptions(),
    corsOrigin: 'http://localhost:3000',
  },
});

async function tokenFor(email: string): Promise<string> {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password: SEED_PASSWORD });
  if (error || !data.session) throw new Error(`signIn(${email}): ${error?.message ?? 'no session'}`);
  return data.session.access_token;
}

function publish(token: string | null) {
  return app.request('/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: '{}',
  });
}

async function setDraft(config: Json): Promise<void> {
  await admin.from('agent_configs').delete().eq('tenant_id', TENANT_B).eq('status', 'draft');
  const { error } = await admin
    .from('agent_configs')
    .insert({ tenant_id: TENANT_B, config, status: 'draft' });
  if (error) throw error;
}

async function activePointer(): Promise<string | null> {
  const { data } = await admin.from('tenants').select('active_prompt_version_id').eq('id', TENANT_B).single();
  return data?.active_prompt_version_id ?? null;
}

let adminToken: string;
let repToken: string;
let originalPointer: string | null;
let originalPublished: Json;

beforeAll(async () => {
  adminToken = await tokenFor('admin@saborcasero.test');
  repToken = await tokenFor('rep@saborcasero.test');
  originalPointer = await activePointer();
  const { data } = await admin
    .from('agent_configs')
    .select('config')
    .eq('tenant_id', TENANT_B)
    .eq('status', 'published')
    .single();
  originalPublished = data!.config;
});

afterAll(async () => {
  // Restore TENANT_B to its seeded state for any later run.
  await admin.from('tenants').update({ active_prompt_version_id: originalPointer }).eq('id', TENANT_B);
  await admin
    .from('agent_configs')
    .update({ config: originalPublished })
    .eq('tenant_id', TENANT_B)
    .eq('status', 'published');
  await admin.from('agent_configs').delete().eq('tenant_id', TENANT_B).eq('status', 'draft');
});

describe('POST /publish (real Postgres)', () => {
  it('rejects a request with no token', async () => {
    const res = await publish(null);
    expect(res.status).toBe(401);
  });

  it('forbids a sales_rep', async () => {
    await setDraft(FOOD_CONFIG as unknown as Json);
    const res = await publish(repToken);
    expect(res.status).toBe(403);
  });

  it('blocks a broken draft and leaves the pointer untouched', async () => {
    const broken = { ...FOOD_CONFIG, orders: { ...FOOD_CONFIG.orders, enabled: false } };
    await setDraft(broken as unknown as Json);
    const before = await activePointer();

    const res = await publish(adminToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { published: boolean; reason?: string };
    expect(body.published).toBe(false);
    expect(body.reason).toBe('gate_failed');

    expect(await activePointer()).toBe(before);
  });

  it('publishes a good draft and flips the pointer atomically', async () => {
    await setDraft(FOOD_CONFIG as unknown as Json);
    const before = await activePointer();

    const res = await publish(adminToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { published: boolean; versionId: string };
    expect(body.published).toBe(true);

    const after = await activePointer();
    expect(after).toBe(body.versionId);
    expect(after).not.toBe(before);

    // The new pointer resolves to a real, insert-only prompt_versions row…
    const { data: version } = await admin
      .from('prompt_versions')
      .select('id, tenant_id, compiler_version')
      .eq('id', body.versionId)
      .single();
    expect(version?.tenant_id).toBe(TENANT_B);

    // …and the published config now matches the draft we just published.
    const { data: published } = await admin
      .from('agent_configs')
      .select('config')
      .eq('tenant_id', TENANT_B)
      .eq('status', 'published')
      .single();
    expect((published?.config as { agent: { displayName: string } }).agent.displayName).toBe(
      FOOD_CONFIG.agent.displayName,
    );
  });
});

describe('POST /playground (real Postgres)', () => {
  it('runs the real loop against the live catalog and persists nothing', async () => {
    const { data: product } = await admin
      .from('products')
      .select('id')
      .eq('tenant_id', TENANT_B)
      .limit(1)
      .single();

    innerModel = new FakeModel('fallback', [
      toolCallTurn({ name: 'check_catalog', args: { query: 'a' } }),
      toolCallTurn({
        name: 'create_order',
        args: { items: [{ product_id: product!.id, qty: 1 }], confirmed: true },
      }),
      textTurn('¡Listo! Te dejo el pedido separado.'),
    ]);

    const before = await Promise.all([
      admin.from('orders').select('id', { count: 'exact', head: true }).eq('tenant_id', TENANT_B),
      admin.from('messages').select('id', { count: 'exact', head: true }).eq('tenant_id', TENANT_B),
    ]);

    const res = await app.request('/playground', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ config: FOOD_CONFIG, messages: [], newMessage: 'Quiero pedir algo' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reply: string; toolCalls: { name: string; ok: boolean }[] };
    expect(body.reply).toContain('Listo');
    expect(body.toolCalls.some((t) => t.name === 'create_order' && t.ok)).toBe(true);

    const after = await Promise.all([
      admin.from('orders').select('id', { count: 'exact', head: true }).eq('tenant_id', TENANT_B),
      admin.from('messages').select('id', { count: 'exact', head: true }).eq('tenant_id', TENANT_B),
    ]);
    expect(after[0].count).toBe(before[0].count);
    expect(after[1].count).toBe(before[1].count);
  });
});
