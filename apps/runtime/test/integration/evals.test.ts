/**
 * ws-r3 §4 integration: the publish gate loading a real draft config from
 * Postgres. Inserts a draft agent_config for the seeded retail tenant, runs
 * evaluateDraft against the real db (which only READS the draft — each fixture
 * still executes against a fresh in-memory EvalDb), and asserts the gate blocks
 * a deliberately-broken draft and passes a good one.
 *
 * Hermetic: the only real row touched is the draft config, deleted in afterAll.
 * Test-only exception: creates its own service client (import ban is src-scoped).
 */
import { WebSocket } from 'ws';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AgentConfig, Database } from '@optiax/shared';
import { RETAIL_CONFIG } from '@optiax/shared/evals';
import { createDb } from '../../src/db/index.js';
import { evaluateDraft } from '../../src/evals/index.js';

globalThis.WebSocket ??= WebSocket as unknown as typeof globalThis.WebSocket;

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const TENANT_A = 'aa000000-0001-4000-8000-000000000001'; // Moda Valentina (retail)

const admin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const db = createDb({ url: SUPABASE_URL, serviceRoleKey: SERVICE_ROLE_KEY });

async function setDraft(config: AgentConfig): Promise<void> {
  await admin.from('agent_configs').delete().eq('tenant_id', TENANT_A).eq('status', 'draft');
  const { error } = await admin
    .from('agent_configs')
    .insert({ tenant_id: TENANT_A, status: 'draft', config: config as unknown as Database['public']['Tables']['agent_configs']['Insert']['config'] });
  if (error) throw error;
}

beforeAll(async () => {
  await admin.from('agent_configs').delete().eq('tenant_id', TENANT_A).eq('status', 'draft');
});

afterAll(async () => {
  await admin.from('agent_configs').delete().eq('tenant_id', TENANT_A).eq('status', 'draft');
});

describe('evaluateDraft publish gate (real db)', () => {
  it('passes a good draft loaded from Postgres', async () => {
    await setDraft(RETAIL_CONFIG);
    const run = await evaluateDraft(TENANT_A, { db });
    expect(run.vertical).toBe('retail');
    expect(run.pass).toBe(true);
  });

  it('blocks a deliberately-broken draft (orders disabled)', async () => {
    const broken: AgentConfig = { ...RETAIL_CONFIG, orders: { ...RETAIL_CONFIG.orders, enabled: false } };
    await setDraft(broken);
    const run = await evaluateDraft(TENANT_A, { db });
    expect(run.pass).toBe(false);
  });

  it('throws when there is no draft to evaluate', async () => {
    await admin.from('agent_configs').delete().eq('tenant_id', TENANT_A).eq('status', 'draft');
    await expect(evaluateDraft(TENANT_A, { db })).rejects.toThrow(/no valid draft/);
  });
});
