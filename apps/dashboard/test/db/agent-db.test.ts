/**
 * DB-backed tests for the configurator (ws-d3 §7) against local seeded Supabase.
 * Proves the RLS surface the screen actually relies on: an admin can read the
 * screen, save a draft, and flip the master toggle; a sales_rep is blocked from
 * both writes. Also a carry-over 0.3 regression: the orders composer persists
 * order_items.sort_order in row order.
 *
 * Uses TENANT_A (Moda Valentina). A service client makes authoritative reads and
 * cleans up. Runs via `pnpm db:test`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { validateAgentConfig, type AgentConfig, type Database } from '@optiax/shared';
import { fetchAgentScreen } from '../../src/lib/agent/queries';
import { saveDraft, setAgentEnabled } from '../../src/lib/agent/mutations';
import { createOrder } from '../../src/lib/orders/mutations';

globalThis.WebSocket ??= WebSocket as unknown as typeof globalThis.WebSocket;

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const TENANT_A = 'aa000000-0001-4000-8000-000000000001';
const ADMIN_A = 'admin@modavalentina.test';
const REP_A = 'rep@modavalentina.test';
const SEED_PASSWORD = 'password123';

let admin: SupabaseClient<Database>;
let rep: SupabaseClient<Database>;
let service: SupabaseClient<Database>;
let adminUserId: string;

async function signIn(email: string): Promise<{ client: SupabaseClient<Database>; userId: string }> {
  const client = createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password: SEED_PASSWORD });
  if (error || !data.user) throw new Error(`signIn(${email}): ${error?.message ?? 'no user'}`);
  return { client, userId: data.user.id };
}

async function clearDraft(): Promise<void> {
  await service.from('agent_configs').delete().eq('tenant_id', TENANT_A).eq('status', 'draft');
}

/** The tenant's published config, modified so a draft visibly differs. */
async function draftFromPublished(displayName: string): Promise<AgentConfig> {
  const { data } = await service
    .from('agent_configs')
    .select('config')
    .eq('tenant_id', TENANT_A)
    .eq('status', 'published')
    .single();
  const parsed = validateAgentConfig(data!.config);
  if (!parsed.ok) throw new Error('seed published config invalid');
  return { ...parsed.config, agent: { ...parsed.config.agent, displayName } };
}

beforeAll(async () => {
  ({ client: admin, userId: adminUserId } = await signIn(ADMIN_A));
  ({ client: rep } = await signIn(REP_A));
  service = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await clearDraft();
});

afterAll(async () => {
  await clearDraft();
  await admin.auth.signOut();
  await rep.auth.signOut();
});

describe('agent screen reads', () => {
  it('gives an admin the config, published state, and resolvable capture options', async () => {
    const data = await fetchAgentScreen(admin, adminUserId);
    expect(data.role).toBe('admin');
    expect(data.published).not.toBeNull();
    expect(data.captureOptions.map((o) => o.key)).toContain('name');
    // TENANT_A seeds attribute_defs, so at least one attribute option appears.
    expect(data.captureOptions.some((o) => o.kind === 'attribute')).toBe(true);
  });
});

describe('admin-only writes (RLS)', () => {
  it('an admin can save a draft, and it then differs from published', async () => {
    await clearDraft();
    await saveDraft(admin, TENANT_A, await draftFromPublished('Vale (borrador)'));
    const data = await fetchAgentScreen(admin, adminUserId);
    expect(data.draft?.agent.displayName).toBe('Vale (borrador)');
    expect(data.draftDiffers).toBe(true);
    await clearDraft();
  });

  it('an admin can flip the master toggle', async () => {
    const { data: before } = await service
      .from('tenants')
      .select('agent_enabled')
      .eq('id', TENANT_A)
      .single();
    const target = !before!.agent_enabled;
    await setAgentEnabled(admin, TENANT_A, target);
    const { data: after } = await service
      .from('tenants')
      .select('agent_enabled')
      .eq('id', TENANT_A)
      .single();
    expect(after!.agent_enabled).toBe(target);
    await service.from('tenants').update({ agent_enabled: before!.agent_enabled }).eq('id', TENANT_A);
  });

  it('a sales_rep cannot insert a draft config', async () => {
    await clearDraft();
    await expect(saveDraft(rep, TENANT_A, await draftFromPublished('Rep intento'))).rejects.toThrow();
    // Nothing landed.
    const { count } = await service
      .from('agent_configs')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', TENANT_A)
      .eq('status', 'draft');
    expect(count).toBe(0);
  });

  it("a sales_rep's master-toggle write is silently a no-op (RLS)", async () => {
    const { data: before } = await service
      .from('tenants')
      .select('agent_enabled')
      .eq('id', TENANT_A)
      .single();
    // RLS blocks the row, so the update affects nothing (no error, no change).
    await setAgentEnabled(rep, TENANT_A, !before!.agent_enabled);
    const { data: after } = await service
      .from('tenants')
      .select('agent_enabled')
      .eq('id', TENANT_A)
      .single();
    expect(after!.agent_enabled).toBe(before!.agent_enabled);
  });
});

describe('carry-over 0.3: composer persists order_items.sort_order', () => {
  it('writes lines in row order and reads them back in that order', async () => {
    const { data: customer } = await service
      .from('customers')
      .select('id')
      .eq('tenant_id', TENANT_A)
      .limit(1)
      .single();

    const order = await createOrder(admin, TENANT_A, 'COP', {
      customer_id: customer!.id,
      items: [
        { product_id: null, description: 'Primero', qty: 1, unit_price: 1000 },
        { product_id: null, description: 'Segundo', qty: 2, unit_price: 2000 },
        { product_id: null, description: 'Tercero', qty: 1, unit_price: 3000 },
      ],
      payment_method_id: null,
      payment_reference: null,
      delivery_address: null,
      delivery_date: null,
      driver_notes: null,
    });

    const { data: items } = await service
      .from('order_items')
      .select('description, sort_order')
      .eq('order_id', order.id)
      .order('sort_order');
    expect(items?.map((i) => [i.description, i.sort_order])).toEqual([
      ['Primero', 0],
      ['Segundo', 1],
      ['Tercero', 2],
    ]);

    await service.from('orders').delete().eq('id', order.id);
  });
});
