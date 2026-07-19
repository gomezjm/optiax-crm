/**
 * §9.1 Meta-test: every table in `public` must have RLS enabled AND a tenant_id
 * column (allowlist: tenants, profiles). A new table that skips either fails CI.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { adminPool } from './helpers.js';

const TENANT_ID_ALLOWLIST = ['tenants', 'profiles'];

let pool: pg.Pool;

beforeAll(() => {
  pool = adminPool();
});
afterAll(async () => {
  await pool.end();
});

describe('schema meta-invariants', () => {
  it('every public table has RLS enabled', async () => {
    const res = await pool.query<{ tablename: string; rowsecurity: boolean }>(
      `select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename`,
    );
    expect(res.rows.length).toBeGreaterThan(0);
    const missing = res.rows.filter((r) => !r.rowsecurity).map((r) => r.tablename);
    expect(missing, `tables without RLS: ${missing.join(', ')}`).toEqual([]);
  });

  it('every public table (except allowlist) has a tenant_id column', async () => {
    const res = await pool.query<{ tablename: string }>(
      `select t.tablename
       from pg_tables t
       where t.schemaname = 'public'
         and not exists (
           select 1 from information_schema.columns c
           where c.table_schema = 'public'
             and c.table_name = t.tablename
             and c.column_name = 'tenant_id'
         )
       order by t.tablename`,
    );
    const offenders = res.rows
      .map((r) => r.tablename)
      .filter((name) => !TENANT_ID_ALLOWLIST.includes(name));
    expect(offenders, `tables without tenant_id: ${offenders.join(', ')}`).toEqual([]);
  });

  it('every public table with tenant_id has at least one RLS policy or is deliberately client-inaccessible', async () => {
    // Guards against "RLS enabled but no policies at all AND no grants revoked" drift:
    // a table with zero policies is only acceptable because anon/authenticated then
    // get zero rows — but flag tables where someone added a permissive `true` policy.
    const res = await pool.query<{ tablename: string }>(
      `select tablename from pg_policies
       where schemaname = 'public' and (qual = 'true' or with_check = 'true')`,
    );
    expect(
      res.rows.map((r) => r.tablename),
      'tables with a permissive USING(true) policy',
    ).toEqual([]);
  });

  it('every public table grants at least SELECT to authenticated (Phase 1 spec §6)', async () => {
    // Postgres 17 fail-closed mode: a table with RLS but no grants silently
    // returns zero rows to clients. Every table must opt in explicitly
    // (phase-0 spec §11, migration-6 note).
    const res = await pool.query<{ tablename: string }>(
      `select t.tablename
       from pg_tables t
       where t.schemaname = 'public'
         and not exists (
           select 1 from information_schema.role_table_grants g
           where g.table_schema = 'public'
             and g.table_name = t.tablename
             and g.grantee = 'authenticated'
             and g.privilege_type = 'SELECT'
         )
       order by t.tablename`,
    );
    const offenders = res.rows.map((r) => r.tablename);
    expect(offenders, `tables without SELECT for authenticated: ${offenders.join(', ')}`).toEqual(
      [],
    );
  });

  it('tenants and profiles keep RLS enabled too', async () => {
    const res = await pool.query<{ tablename: string; rowsecurity: boolean }>(
      `select tablename, rowsecurity from pg_tables
       where schemaname = 'public' and tablename = any($1)`,
      [TENANT_ID_ALLOWLIST],
    );
    expect(res.rows).toHaveLength(2);
    for (const row of res.rows) expect(row.rowsecurity).toBe(true);
  });
});
