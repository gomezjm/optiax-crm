/**
 * Shared helpers for the isolation suite. Runs against local Supabase
 * (`supabase start` + `supabase db reset` + `pnpm seed:auth` first).
 */
import { WebSocket } from 'ws';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';

// supabase-js v2 expects a WebSocket global; Node 20 doesn't provide one.
globalThis.WebSocket ??= WebSocket as unknown as typeof globalThis.WebSocket;

export const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
export const DB_URL =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

// Well-known supabase-demo JWTs shipped with `supabase start`. Local only.
export const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

export const TENANT_A = 'aa000000-0001-4000-8000-000000000001'; // Moda Valentina
export const TENANT_B = 'bb000000-0001-4000-8000-000000000001'; // Sabor Casero

export const USERS = {
  adminA: 'admin@modavalentina.test',
  repA: 'rep@modavalentina.test',
  adminB: 'admin@saborcasero.test',
  repB: 'rep@saborcasero.test',
} as const;
export const SEED_PASSWORD = 'password123';

/** All public tables. Keep in sync with migrations — the meta-test cross-checks. */
export const TENANT_TABLES = [
  'agent_configs',
  'prompt_versions',
  'conversations',
  'messages',
  'agent_turns',
  'webhook_events',
  'customers',
  'tags',
  'customer_tags',
  'attribute_defs',
  'segments',
  'product_categories',
  'products',
  'order_statuses',
  'orders',
  'order_items',
  'payment_methods',
  'wa_templates',
  'campaigns',
  'auto_reply_rules',
] as const;
export type TenantTable = (typeof TENANT_TABLES)[number];

export const ALL_TABLES = ['tenants', 'profiles', ...TENANT_TABLES] as const;

export function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function signIn(email: string): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: SEED_PASSWORD });
  if (error) {
    throw new Error(
      `signIn(${email}) failed: ${error.message} — did you run \`supabase db reset\` and \`pnpm seed:auth\`?`,
    );
  }
  return client;
}

/** Direct superuser connection for catalog inspection and fixture lookups. */
export function adminPool(): pg.Pool {
  return new pg.Pool({ connectionString: DB_URL, max: 2 });
}

/** Row ids of seed data, resolved once per suite via the superuser connection. */
export interface SeedRefs {
  a: TenantRefs;
  b: TenantRefs;
}
export interface TenantRefs {
  tenantId: string;
  customerId: string;
  conversationId: string;
  tagId: string;
  segmentId: string;
  templateId: string;
  orderId: string;
  orderStatusId: string;
  promptVersionId: string;
  productId: string;
}

export async function loadSeedRefs(pool: pg.Pool): Promise<SeedRefs> {
  const one = async (sql: string, tenantId: string): Promise<string> => {
    const res = await pool.query<{ id: string }>(sql, [tenantId]);
    if (res.rows.length === 0 || !res.rows[0]) throw new Error(`seed row missing: ${sql}`);
    return res.rows[0].id;
  };
  const refs = async (tenantId: string): Promise<TenantRefs> => ({
    tenantId,
    customerId: await one('select id from public.customers where tenant_id = $1 limit 1', tenantId),
    conversationId: await one(
      'select id from public.conversations where tenant_id = $1 limit 1',
      tenantId,
    ),
    tagId: await one('select id from public.tags where tenant_id = $1 limit 1', tenantId),
    segmentId: await one('select id from public.segments where tenant_id = $1 limit 1', tenantId),
    templateId: await one(
      'select id from public.wa_templates where tenant_id = $1 limit 1',
      tenantId,
    ),
    orderId: await one('select id from public.orders where tenant_id = $1 limit 1', tenantId),
    orderStatusId: await one(
      'select id from public.order_statuses where tenant_id = $1 limit 1',
      tenantId,
    ),
    promptVersionId: await one(
      'select id from public.prompt_versions where tenant_id = $1 limit 1',
      tenantId,
    ),
    productId: await one('select id from public.products where tenant_id = $1 limit 1', tenantId),
  });
  return { a: await refs(TENANT_A), b: await refs(TENANT_B) };
}

/**
 * Minimal valid insert payload per table, targeting the given tenant's rows for
 * FK fields. Used to prove cross-tenant INSERTs are rejected.
 */
export function insertPayloadFor(table: TenantTable, refs: TenantRefs): Record<string, unknown> {
  const t = refs.tenantId;
  const rand = Math.random().toString(36).slice(2, 10);
  switch (table) {
    case 'agent_configs':
      return { tenant_id: t, config: { version: 1 }, status: 'draft' };
    case 'prompt_versions':
      return {
        tenant_id: t,
        compiled_prompt: 'x',
        config_snapshot: {},
        compiler_version: '0.0.0-test',
        vertical: 'generic',
      };
    case 'conversations':
      return { tenant_id: t, wa_id: `test-${rand}` };
    case 'messages':
      return {
        tenant_id: t,
        conversation_id: refs.conversationId,
        direction: 'outbound',
        source: 'dashboard',
        type: 'text',
        body: 'test',
      };
    case 'agent_turns':
      return {
        tenant_id: t,
        conversation_id: refs.conversationId,
        prompt_version_id: refs.promptVersionId,
        model: 'test',
        latency_ms: 1,
        input_tokens: 1,
        output_tokens: 1,
        tool_calls: [],
      };
    case 'webhook_events':
      return { tenant_id: t, event_type: 'test', payload: {} };
    case 'customers':
      return { tenant_id: t, name: `Test ${rand}`, source: 'manual' };
    case 'tags':
      return { tenant_id: t, name: `test-${rand}`, color: '#000000' };
    case 'customer_tags':
      return { tenant_id: t, customer_id: refs.customerId, tag_id: refs.tagId };
    case 'attribute_defs':
      return { tenant_id: t, key: `test_${rand}`, label: 'Test', type: 'text' };
    case 'segments':
      return {
        tenant_id: t,
        name: `test-${rand}`,
        rules: { combinator: 'and', conditions: [{ field: 'city', op: 'eq', value: 'x' }] },
      };
    case 'product_categories':
      return { tenant_id: t, name: `test-${rand}` };
    case 'products':
      return { tenant_id: t, name: `Test ${rand}`, price: 1000 };
    case 'order_statuses':
      return { tenant_id: t, name: `Test ${rand}`, sort_order: 99, kind: 'new' };
    case 'orders':
      return {
        tenant_id: t,
        customer_id: refs.customerId,
        status_id: refs.orderStatusId,
        total: 1000,
        currency: 'COP',
        source: 'manual',
      };
    case 'order_items':
      return {
        tenant_id: t,
        order_id: refs.orderId,
        description: 'test item',
        qty: 1,
        unit_price: 1000,
      };
    case 'payment_methods':
      return { tenant_id: t, label: `Test ${rand}`, details: 'test' };
    case 'wa_templates':
      return { tenant_id: t, name: `test_${rand}`, category: 'MARKETING', body: 'test' };
    case 'campaigns':
      return {
        tenant_id: t,
        name: `test-${rand}`,
        template_id: refs.templateId,
        segment_id: refs.segmentId,
      };
    case 'auto_reply_rules':
      return {
        tenant_id: t,
        name: `test-${rand}`,
        trigger: { kind: 'first_message' },
        response: 'test',
      };
  }
}

/** An innocuous column to touch in UPDATE-affects-0-rows probes. */
export const UPDATE_PROBE: Record<TenantTable, Record<string, unknown>> = {
  agent_configs: { config: { version: 1, probed: true } },
  prompt_versions: { compiler_version: 'probe' },
  conversations: { needs_attention: true },
  messages: { body: 'probe' },
  agent_turns: { model: 'probe' },
  webhook_events: { event_type: 'probe' },
  customers: { name: 'probe' },
  tags: { color: '#111111' },
  customer_tags: { created_at: new Date().toISOString() },
  attribute_defs: { label: 'probe' },
  segments: { name: 'probe' },
  product_categories: { name: 'probe' },
  products: { description: 'probe' },
  order_statuses: { name: 'probe' },
  orders: { driver_notes: 'probe' },
  order_items: { description: 'probe' },
  payment_methods: { details: 'probe' },
  wa_templates: { body: 'probe' },
  campaigns: { name: 'probe' },
  auto_reply_rules: { response: 'probe' },
};
