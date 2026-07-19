/**
 * DB-backed tests (WS-D1 §8) against local seeded Supabase, signed in as the
 * seeded sales_rep — proving the RLS/grant surface the dashboard actually
 * uses. Rows created here are cleaned up best-effort; phone numbers are
 * random per run so reruns stay idempotent.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@optiax/shared';

// supabase-js v2 expects a WebSocket global; Node 20 doesn't provide one
// (same shim as supabase/tests/helpers.ts).
globalThis.WebSocket ??= WebSocket as unknown as typeof globalThis.WebSocket;
import { importCustomers } from '../../src/lib/customers/import';
import { massEdit } from '../../src/lib/customers/mass-edit';
import { createCustomer, updateCustomer } from '../../src/lib/customers/mutations';
import { fetchCustomersPage } from '../../src/lib/customers/list';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const TENANT_A = 'aa000000-0001-4000-8000-000000000001'; // Moda Valentina
const REP_A = 'rep@modavalentina.test';
const SEED_PASSWORD = 'password123';
/** Seeded Camila Rojas phone — the import dedupe target. */
const SEEDED_PHONE = '+57 301 555 0101';

let rep: SupabaseClient<Database>;
const createdCustomerIds: string[] = [];

function randomPhone(): string {
  return `5730${Math.floor(Math.random() * 1_000_000_000)
    .toString()
    .padStart(9, '0')}`;
}

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
});

afterAll(async () => {
  if (createdCustomerIds.length > 0) {
    await rep.from('customers').delete().in('id', createdCustomerIds);
  }
  await rep.auth.signOut();
});

async function trackByPhone(digits: string) {
  const { data } = await rep.from('customers').select('id').eq('phone', digits);
  for (const row of data ?? []) createdCustomerIds.push(row.id);
}

describe('import batch (dedupe-skip against seed data)', () => {
  it('skips seeded duplicates and in-file duplicates, imports the rest with source=import', async () => {
    const freshPhone = randomPhone();
    const rows = [
      {
        rowNumber: 1,
        row: {
          name: 'Duplicada De Camila',
          phone: SEEDED_PHONE,
          consent_status: 'unknown' as const,
          attributes: {},
        },
      },
      {
        rowNumber: 2,
        row: {
          name: 'Cliente Nueva Import',
          phone: freshPhone,
          consent_status: 'opted_in' as const,
          attributes: { barrio_entrega: 'Laureles' },
        },
      },
      {
        rowNumber: 3,
        row: {
          name: 'Repetida En Archivo',
          phone: freshPhone,
          consent_status: 'unknown' as const,
          attributes: {},
        },
      },
    ];

    const result = await importCustomers(rep, TENANT_A, rows);
    await trackByPhone(freshPhone);

    expect(result.imported).toBe(1);
    expect(result.failed).toEqual([]);
    expect(result.skipped.map((s) => s.rowNumber).sort()).toEqual([1, 3]);
    // The seeded duplicate reports who it collided with.
    expect(result.skipped.find((s) => s.rowNumber === 1)?.existingName).toBe('Camila Rojas');

    const { data: inserted } = await rep
      .from('customers')
      .select('name, phone, source, consent_status, attributes')
      .eq('phone', freshPhone)
      .single();
    expect(inserted).toMatchObject({
      name: 'Cliente Nueva Import',
      phone: freshPhone,
      source: 'import',
      consent_status: 'opted_in',
      attributes: { barrio_entrega: 'Laureles' },
    });
  });

  it('re-importing the same file skips everything (never overwrites)', async () => {
    const phone = randomPhone();
    const rows = [
      {
        rowNumber: 1,
        row: { name: 'Idempotente', phone, consent_status: 'unknown' as const, attributes: {} },
      },
    ];
    const first = await importCustomers(rep, TENANT_A, rows);
    await trackByPhone(phone);
    expect(first.imported).toBe(1);

    const second = await importCustomers(rep, TENANT_A, rows);
    expect(second.imported).toBe(0);
    expect(second.skipped).toHaveLength(1);
  });
});

describe('mass edit batch', () => {
  it('adds/removes tags, sets an attribute and consent over a selection', async () => {
    const phoneA = randomPhone();
    const phoneB = randomPhone();
    const created = await Promise.all(
      [phoneA, phoneB].map(async (phone, i) => {
        const result = await createCustomer(rep, TENANT_A, {
          name: `Masivo ${i} ${phone}`,
          phone,
          email: null,
          address: null,
          city: null,
          gender: null,
          age_group: null,
          consent_status: 'unknown',
          attributes: {},
        });
        if (result.outcome !== 'created') throw new Error('setup failed: duplicate');
        createdCustomerIds.push(result.customer.id);
        return result.customer;
      }),
    );
    const ids = created.map((c) => c.id);

    const { data: seedTag } = await rep
      .from('tags')
      .select('id')
      .eq('name', 'Nueva')
      .single();
    if (!seedTag) throw new Error('seed tag missing');

    const addResult = await massEdit(rep, TENANT_A, ids, {
      kind: 'add_tags',
      tagIds: [seedTag.id],
    });
    expect(addResult).toEqual({ updated: 2, errors: 0 });
    const { data: tagged } = await rep
      .from('customer_tags')
      .select('customer_id')
      .in('customer_id', ids);
    expect(tagged).toHaveLength(2);

    // Adding again is a no-op (upsert ignoreDuplicates), not an error.
    const readd = await massEdit(rep, TENANT_A, ids, { kind: 'add_tags', tagIds: [seedTag.id] });
    expect(readd.errors).toBe(0);

    const attrResult = await massEdit(rep, TENANT_A, ids, {
      kind: 'set_attribute',
      key: 'barrio_entrega',
      value: 'Centro',
    });
    expect(attrResult).toEqual({ updated: 2, errors: 0 });

    const consentResult = await massEdit(rep, TENANT_A, ids, {
      kind: 'set_consent',
      consent: 'opted_in',
    });
    expect(consentResult).toEqual({ updated: 2, errors: 0 });

    const { data: after } = await rep
      .from('customers')
      .select('attributes, consent_status')
      .in('id', ids);
    for (const row of after ?? []) {
      expect(row.consent_status).toBe('opted_in');
      expect(row.attributes).toMatchObject({ barrio_entrega: 'Centro' });
    }

    const removeResult = await massEdit(rep, TENANT_A, ids, {
      kind: 'remove_tags',
      tagIds: [seedTag.id],
    });
    expect(removeResult.errors).toBe(0);
    const { data: untagged } = await rep
      .from('customer_tags')
      .select('customer_id')
      .in('customer_id', ids);
    expect(untagged).toHaveLength(0);
  });
});

describe('rep role surface', () => {
  it('rep can update customers (RLS + grants)', async () => {
    const phone = randomPhone();
    const created = await createCustomer(rep, TENANT_A, {
      name: `Editable ${phone}`,
      phone,
      email: null,
      address: null,
      city: null,
      gender: null,
      age_group: null,
      consent_status: 'unknown',
      attributes: {},
    });
    if (created.outcome !== 'created') throw new Error('setup failed');
    createdCustomerIds.push(created.customer.id);

    const updated = await updateCustomer(rep, created.customer.id, {
      name: 'Editada Por Rep',
      phone,
      email: 'rep.edit@example.test',
      address: null,
      city: 'Medellín',
      gender: null,
      age_group: '25-34',
      consent_status: 'opted_in',
      attributes: { barrio_entrega: 'Poblado' },
    });
    expect(updated.name).toBe('Editada Por Rep');
    expect(updated.city).toBe('Medellín');
  });

  it('the list query returns seeded tenant-A customers only', async () => {
    const page = await fetchCustomersPage(rep, {});
    expect(page.total).toBeGreaterThanOrEqual(2);
    const names = page.items.map((i) => i.customer.name);
    expect(names).toContain('Camila Rojas');
    // Tenant B seed data must never appear.
    expect(names).not.toContain('Andrés Pardo');
  });

  it('attribute, tag and metric filters translate to working PostgREST queries', async () => {
    // Seed: Camila talla M / tag Nueva / spent 224000; Juliana talla S /
    // tag VIP / spent 468000 / cumpleanos 1988-11-02.
    const byTalla = await fetchCustomersPage(rep, {
      attributes: [{ key: 'talla_preferida', type: 'select', value: 'M' }],
    });
    expect(byTalla.items.map((i) => i.customer.name)).toContain('Camila Rojas');
    expect(byTalla.items.map((i) => i.customer.name)).not.toContain('Juliana Torres');

    const byDate = await fetchCustomersPage(rep, {
      attributes: [{ key: 'cumpleanos', type: 'date', min: '1988-01-01', max: '1989-01-01' }],
    });
    expect(byDate.items.map((i) => i.customer.name)).toEqual(['Juliana Torres']);

    const { data: vipTag } = await rep.from('tags').select('id').eq('name', 'VIP').single();
    if (!vipTag) throw new Error('seed tag missing');
    const byTag = await fetchCustomersPage(rep, { tagIds: [vipTag.id] });
    expect(byTag.items.map((i) => i.customer.name)).toEqual(['Juliana Torres']);
    expect(byTag.items[0]?.tags.map((tag) => tag.name)).toContain('VIP');

    const bySpent = await fetchCustomersPage(rep, { totalSpentMin: 400000 });
    expect(bySpent.items.map((i) => i.customer.name)).toContain('Juliana Torres');
    expect(bySpent.items.map((i) => i.customer.name)).not.toContain('Camila Rojas');

    const combined = await fetchCustomersPage(rep, {
      tagIds: [vipTag.id],
      attributes: [{ key: 'talla_preferida', type: 'select', value: 'S' }],
      consent: 'opted_in',
    });
    expect(combined.items.map((i) => i.customer.name)).toEqual(['Juliana Torres']);
  });

  it('regression canary: rep cannot write an admin-only table', async () => {
    const { error } = await rep.from('auto_reply_rules').insert({
      tenant_id: TENANT_A,
      name: 'rep-should-not-write-this',
      trigger: { kind: 'first_message' },
      response: 'nope',
    });
    expect(error).not.toBeNull();
  });
});
