/**
 * §9.2 Cross-tenant matrix: authenticated as a tenant-A user, for every table —
 * SELECT returns only A rows; INSERT with B's tenant_id fails; UPDATE/DELETE of
 * B rows affects 0 rows.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type pg from 'pg';
import {
  TENANT_A,
  TENANT_B,
  TENANT_TABLES,
  UPDATE_PROBE,
  USERS,
  adminPool,
  insertPayloadFor,
  loadSeedRefs,
  signIn,
  type SeedRefs,
} from './helpers.js';

let pool: pg.Pool;
let refs: SeedRefs;
let clientA: SupabaseClient;

beforeAll(async () => {
  pool = adminPool();
  refs = await loadSeedRefs(pool);
  clientA = await signIn(USERS.adminA);
});
afterAll(async () => {
  await clientA.auth.signOut();
  await pool.end();
});

describe('cross-tenant isolation (tenant-A admin)', () => {
  describe('SELECT returns only tenant-A rows', () => {
    it('tenants: only own tenant row', async () => {
      const { data, error } = await clientA.from('tenants').select('id');
      expect(error).toBeNull();
      expect(data).toEqual([{ id: TENANT_A }]);
    });

    it('profiles: only own tenant profiles', async () => {
      const { data, error } = await clientA.from('profiles').select('tenant_id');
      expect(error).toBeNull();
      expect(data?.length).toBeGreaterThan(0);
      for (const row of data ?? []) expect(row.tenant_id).toBe(TENANT_A);
    });

    for (const table of TENANT_TABLES) {
      it(table, async () => {
        const { data, error } = await clientA.from(table).select('tenant_id');
        expect(error).toBeNull();
        // Both tenants have seed rows in every table except runtime-only ones;
        // whatever comes back must be tenant A's.
        for (const row of data ?? []) expect(row.tenant_id).toBe(TENANT_A);
        // And B must have rows the query did NOT return, wherever B has any:
        const bCount = await pool.query(
          `select count(*)::int as n from public.${table} where tenant_id = $1`,
          [TENANT_B],
        );
        if ((bCount.rows[0]?.n ?? 0) > 0) {
          const aVisible = (data ?? []).length;
          const aActual = await pool.query(
            `select count(*)::int as n from public.${table} where tenant_id = $1`,
            [TENANT_A],
          );
          expect(aVisible).toBe(aActual.rows[0]?.n ?? -1);
        }
      });
    }
  });

  describe("INSERT with B's tenant_id fails", () => {
    it('tenants: client INSERT rejected entirely', async () => {
      const { error } = await clientA
        .from('tenants')
        .insert({ name: 'Evil Tenant', vertical: 'generic' });
      expect(error).not.toBeNull();
    });

    for (const table of TENANT_TABLES) {
      it(table, async () => {
        const before = await pool.query(
          `select count(*)::int as n from public.${table} where tenant_id = $1`,
          [TENANT_B],
        );
        const payload = insertPayloadFor(table, refs.b);
        const { data, error } = await clientA.from(table).insert(payload).select();
        expect(error, `insert into ${table} with tenant B id must fail`).not.toBeNull();
        expect(data ?? []).toEqual([]);
        // Belt & suspenders: nothing landed in B's partition.
        const after = await pool.query(
          `select count(*)::int as n from public.${table} where tenant_id = $1`,
          [TENANT_B],
        );
        expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
      });
    }
  });

  describe('UPDATE of B rows affects 0 rows', () => {
    it('tenants', async () => {
      const { data, error } = await clientA
        .from('tenants')
        .update({ name: 'Hacked' })
        .eq('id', TENANT_B)
        .select();
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    for (const table of TENANT_TABLES) {
      it(table, async () => {
        const { data, error } = await clientA
          .from(table)
          .update(UPDATE_PROBE[table])
          .eq('tenant_id', TENANT_B)
          .select();
        // RLS hides B's rows → 0 rows matched. (Immutable tables may error instead.)
        if (error) {
          expect(data ?? []).toEqual([]);
        } else {
          expect(data).toEqual([]);
        }
      });
    }
  });

  describe('DELETE of B rows affects 0 rows', () => {
    for (const table of TENANT_TABLES) {
      it(table, async () => {
        const before = await pool.query(
          `select count(*)::int as n from public.${table} where tenant_id = $1`,
          [TENANT_B],
        );
        const { data } = await clientA.from(table).delete().eq('tenant_id', TENANT_B).select();
        expect(data ?? []).toEqual([]);
        const after = await pool.query(
          `select count(*)::int as n from public.${table} where tenant_id = $1`,
          [TENANT_B],
        );
        expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
      });
    }
  });

  describe('positive control: tenant-A admin CAN write own operational rows', () => {
    it('customers: insert + update + delete own row', async () => {
      const { data: inserted, error: insertError } = await clientA
        .from('customers')
        .insert({ tenant_id: TENANT_A, name: 'Prueba Positiva', source: 'manual' })
        .select('id')
        .single();
      expect(insertError).toBeNull();
      const id = inserted?.id as string;

      const { data: updated, error: updateError } = await clientA
        .from('customers')
        .update({ city: 'Cali' })
        .eq('id', id)
        .select();
      expect(updateError).toBeNull();
      expect(updated).toHaveLength(1);

      const { error: deleteError } = await clientA.from('customers').delete().eq('id', id);
      expect(deleteError).toBeNull();
    });
  });
});
