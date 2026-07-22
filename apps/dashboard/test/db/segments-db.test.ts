/**
 * DB-backed tests for the segment engine (ws-c1 §5) against local seeded
 * Supabase, signed in as the seeded sales_rep. Proves the shared engine +
 * dashboard executor resolve real seeded audiences through the anon-key + RLS
 * surface — templates, compound rules, tag/attribute rules, and tenant
 * isolation. Rows created here are cleaned up best-effort.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database, SegmentEvalContext, SegmentRules } from '@optiax/shared';

globalThis.WebSocket ??= WebSocket as unknown as typeof globalThis.WebSocket;
import { fetchEnabledAttributeDefs } from '../../src/lib/customers/list';
import { evalSegmentCount, evalSegmentMembers } from '../../src/lib/segments/executor';
import {
  buildEvalContext,
  fetchSegmentsWithCounts,
  fetchTenantTimeZone,
  parseRules,
} from '../../src/lib/segments/queries';
import { createSegment, deleteSegment, updateSegment } from '../../src/lib/segments/mutations';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const TENANT_A = 'aa000000-0001-4000-8000-000000000001';
const SEED_PASSWORD = 'password123';

let repA: SupabaseClient<Database>;
let repB: SupabaseClient<Database>;
let ctxA: SegmentEvalContext;
const createdSegmentIds: string[] = [];

async function signIn(email: string): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: SEED_PASSWORD });
  if (error) {
    throw new Error(
      `signIn(${email}) failed: ${error.message} — run \`supabase db reset\` + \`pnpm seed:auth\` first`,
    );
  }
  return client;
}

/** Member names for a rule, sorted for stable comparison. */
async function memberNames(
  client: SupabaseClient<Database>,
  rules: SegmentRules,
  ctx: SegmentEvalContext,
): Promise<string[]> {
  const page = await evalSegmentMembers(client, rules, ctx);
  return page.items.map((i) => i.customer.name ?? '').sort();
}

const rule = (combinator: 'and' | 'or', conditions: SegmentRules['conditions']): SegmentRules => ({
  combinator,
  conditions,
});

beforeAll(async () => {
  repA = await signIn('rep@modavalentina.test');
  repB = await signIn('rep@saborcasero.test');
  const defs = await fetchEnabledAttributeDefs(repA);
  const tz = await fetchTenantTimeZone(repA);
  ctxA = buildEvalContext(tz, defs);
});

afterAll(async () => {
  if (createdSegmentIds.length > 0) await repA.from('segments').delete().in('id', createdSegmentIds);
  await repA.auth.signOut();
  await repB.auth.signOut();
});

describe('seeded templates resolve to the expected audiences', () => {
  it('each template returns its expected seeded members (tenant A)', async () => {
    const withCounts = await fetchSegmentsWithCounts(repA, ctxA);
    const byName = new Map(withCounts.map((s) => [s.segment.name, s]));

    // "En riesgo": last order older than 30 days → only Juliana (41 days).
    const enRiesgo = byName.get('En riesgo');
    expect(enRiesgo?.segment.is_template).toBe(true);
    expect(enRiesgo?.count).toBe(1);
    expect(await memberNames(repA, parseRules(enRiesgo!.segment.rules)!, ctxA)).toEqual([
      'Juliana Torres',
    ]);

    // "VIP": total_spent >= 200000 → Camila (215k) + Juliana (452k).
    const vip = byName.get('VIP');
    expect(vip?.count).toBe(2);
    expect(await memberNames(repA, parseRules(vip!.segment.rules)!, ctxA)).toEqual([
      'Camila Rojas',
      'Juliana Torres',
    ]);

    // "Solo curiosean": has messages but no orders (is_set + is_empty) → Sofía.
    const curiosean = byName.get('Solo curiosean');
    expect(curiosean?.count).toBe(1);
    expect(await memberNames(repA, parseRules(curiosean!.segment.rules)!, ctxA)).toEqual([
      'Sofía Herrera',
    ]);
  });
});

describe('rule shapes', () => {
  it('a tag-membership rule returns the tagged customers', async () => {
    const names = await memberNames(repA, rule('and', [{ field: 'tag', op: 'contains', value: 'VIP' }]), ctxA);
    expect(names).toEqual(['Juliana Torres']);
  });

  it('an attribute rule (jsonb) returns the matching customers', async () => {
    const names = await memberNames(
      repA,
      rule('and', [{ field: 'attribute.talla_preferida', op: 'eq', value: 'M' }]),
      ctxA,
    );
    expect(names).toEqual(['Camila Rojas']);
  });

  it('a compound AND narrows the set', async () => {
    // total_spent >= 200000 AND city = Medellín → Camila only (Juliana is Envigado).
    const names = await memberNames(
      repA,
      rule('and', [
        { field: 'total_spent', op: 'gte', value: 200000 },
        { field: 'city', op: 'eq', value: 'Medellín' },
      ]),
      ctxA,
    );
    expect(names).toEqual(['Camila Rojas']);
  });

  it('a compound OR widens the set', async () => {
    // city = Medellín OR total_spent >= 400000 → Camila (Medellín) + Juliana (452k).
    const names = await memberNames(
      repA,
      rule('or', [
        { field: 'city', op: 'eq', value: 'Medellín' },
        { field: 'total_spent', op: 'gte', value: 400000 },
      ]),
      ctxA,
    );
    expect(names).toEqual(['Camila Rojas', 'Juliana Torres']);
  });

  it('a presence rule (is_empty) finds customers with no orders', async () => {
    const names = await memberNames(repA, rule('and', [{ field: 'last_order_at', op: 'is_empty' }]), ctxA);
    expect(names).toEqual(['Sofía Herrera']);
  });
});

describe('tenant isolation', () => {
  it('evaluating as tenant A never sees tenant B customers (RLS canary)', async () => {
    // Both of tenant B's customers live in Bogotá; tenant A has none there.
    const count = await evalSegmentCount(repA, rule('and', [{ field: 'city', op: 'eq', value: 'Bogotá' }]), ctxA);
    expect(count).toBe(0);
  });

  it('the same rule resolves tenant B customers for tenant B', async () => {
    const tzB = await fetchTenantTimeZone(repB);
    const defsB = await fetchEnabledAttributeDefs(repB);
    const ctxB = buildEvalContext(tzB, defsB);
    const names = await memberNames(repB, rule('and', [{ field: 'city', op: 'eq', value: 'Bogotá' }]), ctxB);
    expect(names).toEqual(['Andrés Pardo', 'María Fernanda López']);
  });
});

describe('rep writes (segments are operational)', () => {
  it('a rep can create, evaluate, update and delete a segment', async () => {
    const created = await createSegment(repA, TENANT_A, {
      name: `VIP en Medellín ${Date.now()}`,
      rules: rule('and', [
        { field: 'total_spent', op: 'gte', value: 200000 },
        { field: 'city', op: 'eq', value: 'Medellín' },
      ]),
    });
    createdSegmentIds.push(created.id);
    expect(created.is_template).toBe(false);

    const count = await evalSegmentCount(repA, parseRules(created.rules)!, ctxA);
    expect(count).toBe(1); // Camila

    const updated = await updateSegment(repA, created.id, {
      name: created.name,
      rules: rule('and', [{ field: 'total_spent', op: 'gte', value: 100000 }]),
    });
    // tenant A ≥ 100k: Camila (215k) + Juliana (452k); Sofía (0) excluded.
    expect(await evalSegmentCount(repA, parseRules(updated.rules)!, ctxA)).toBe(2);

    await deleteSegment(repA, created.id);
    createdSegmentIds.pop();
    const { data } = await repA.from('segments').select('id').eq('id', created.id).maybeSingle();
    expect(data).toBeNull();
  });
});
