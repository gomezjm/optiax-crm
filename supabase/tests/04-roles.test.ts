/**
 * §9.4 Role matrix: sales_rep blocked from writes on master/config tables,
 * allowed on operational ones (full read everywhere in-tenant).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type pg from 'pg';
import {
  TENANT_A,
  adminPool,
  insertPayloadFor,
  loadSeedRefs,
  signIn,
  USERS,
  type SeedRefs,
  type TenantTable,
} from './helpers.js';

/** Master/config tables: admin-only writes (spec §3; auto_reply_rules + campaigns
 *  treated as config — see SESSION_NOTES.md). */
const MASTER_TABLES: TenantTable[] = [
  'agent_configs',
  'prompt_versions',
  'order_statuses',
  'payment_methods',
  'attribute_defs',
  'wa_templates',
  'campaigns',
  'auto_reply_rules',
];

/** Operational tables a sales_rep can write (cleanup-friendly subset probes). */
const OPERATIONAL_PROBES: TenantTable[] = ['customers', 'tags', 'segments', 'product_categories'];

let pool: pg.Pool;
let refs: SeedRefs;
let rep: SupabaseClient;

beforeAll(async () => {
  pool = adminPool();
  refs = await loadSeedRefs(pool);
  rep = await signIn(USERS.repA);
});
afterAll(async () => {
  await rep.auth.signOut();
  await pool.end();
});

describe('sales_rep role restrictions (tenant A rep)', () => {
  it('reads everything in-tenant (spot check: agent_configs, payment_methods, wa_templates)', async () => {
    for (const table of ['agent_configs', 'payment_methods', 'wa_templates'] as const) {
      const { data, error } = await rep.from(table).select('tenant_id');
      expect(error, table).toBeNull();
      expect(data?.length, table).toBeGreaterThan(0);
      for (const row of data ?? []) expect(row.tenant_id).toBe(TENANT_A);
    }
  });

  for (const table of MASTER_TABLES) {
    it(`${table}: INSERT blocked even in own tenant`, async () => {
      const { error } = await rep.from(table).insert(insertPayloadFor(table, refs.a)).select();
      expect(error).not.toBeNull();
    });

    it(`${table}: UPDATE of own-tenant rows affects 0 rows`, async () => {
      const { data, error } = await rep
        .from(table)
        .update({ created_at: new Date().toISOString() })
        .eq('tenant_id', TENANT_A)
        .select();
      if (error === null) {
        expect(data).toEqual([]);
      } else {
        expect(data ?? []).toEqual([]);
      }
    });

    it(`${table}: DELETE of own-tenant rows affects 0 rows`, async () => {
      const before = await pool.query(
        `select count(*)::int as n from public.${table} where tenant_id = $1`,
        [TENANT_A],
      );
      const { data } = await rep.from(table).delete().eq('tenant_id', TENANT_A).select();
      expect(data ?? []).toEqual([]);
      const after = await pool.query(
        `select count(*)::int as n from public.${table} where tenant_id = $1`,
        [TENANT_A],
      );
      expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    });
  }

  it('tenants: rep cannot update own tenant row', async () => {
    const { data, error } = await rep
      .from('tenants')
      .update({ name: 'Rep Was Here' })
      .eq('id', TENANT_A)
      .select();
    if (error === null) {
      expect(data).toEqual([]);
    } else {
      expect(data ?? []).toEqual([]);
    }
  });

  it('profiles: rep cannot change roles', async () => {
    const { data, error } = await rep
      .from('profiles')
      .update({ role: 'admin' })
      .eq('tenant_id', TENANT_A)
      .select();
    if (error === null) {
      expect(data).toEqual([]);
    } else {
      expect(data ?? []).toEqual([]);
    }
  });

  for (const table of OPERATIONAL_PROBES) {
    it(`${table}: rep CAN insert + delete own-tenant rows`, async () => {
      const payload = insertPayloadFor(table, refs.a);
      const { data: inserted, error: insertError } = await rep
        .from(table)
        .insert(payload)
        .select('id')
        .single();
      expect(insertError, `rep insert into ${table}`).toBeNull();
      const id = inserted?.id as string;

      const { error: deleteError } = await rep.from(table).delete().eq('id', id);
      expect(deleteError).toBeNull();
    });
  }

  it('messages: rep CAN write into an own-tenant conversation', async () => {
    const { data, error } = await rep
      .from('messages')
      .insert({
        tenant_id: TENANT_A,
        conversation_id: refs.a.conversationId,
        direction: 'outbound',
        source: 'dashboard',
        type: 'text',
        body: 'Mensaje de prueba del asesor',
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    await rep.from('messages').delete().eq('id', data?.id as string);
  });
});
