/**
 * §9.6 Immutability: UPDATE/DELETE on prompt_versions fails even for the
 * tenant's own admin.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type pg from 'pg';
import { TENANT_A, USERS, adminPool, loadSeedRefs, signIn } from './helpers.js';

let pool: pg.Pool;
let clientA: SupabaseClient;
let promptVersionId: string;
let originalPrompt: string;

beforeAll(async () => {
  pool = adminPool();
  const refs = await loadSeedRefs(pool);
  promptVersionId = refs.a.promptVersionId;
  const res = await pool.query<{ compiled_prompt: string }>(
    'select compiled_prompt from public.prompt_versions where id = $1',
    [promptVersionId],
  );
  originalPrompt = res.rows[0]?.compiled_prompt ?? '';
  clientA = await signIn(USERS.adminA);
});
afterAll(async () => {
  await clientA.auth.signOut();
  await pool.end();
});

describe('prompt_versions immutability (tenant admin)', () => {
  it('admin can SELECT own prompt versions', async () => {
    const { data, error } = await clientA
      .from('prompt_versions')
      .select('id, tenant_id')
      .eq('id', promptVersionId)
      .single();
    expect(error).toBeNull();
    expect(data?.tenant_id).toBe(TENANT_A);
  });

  it('UPDATE fails even for the owning tenant admin', async () => {
    const { data, error } = await clientA
      .from('prompt_versions')
      .update({ compiled_prompt: 'tampered' })
      .eq('id', promptVersionId)
      .select();
    // UPDATE grant is revoked → hard permission error expected (not just 0 rows).
    expect(error).not.toBeNull();
    expect(data ?? []).toEqual([]);

    const check = await pool.query<{ compiled_prompt: string }>(
      'select compiled_prompt from public.prompt_versions where id = $1',
      [promptVersionId],
    );
    expect(check.rows[0]?.compiled_prompt).toBe(originalPrompt);
  });

  it('DELETE fails even for the owning tenant admin', async () => {
    const { error } = await clientA
      .from('prompt_versions')
      .delete()
      .eq('id', promptVersionId)
      .select();
    expect(error).not.toBeNull();

    const check = await pool.query('select 1 from public.prompt_versions where id = $1', [
      promptVersionId,
    ]);
    expect(check.rows).toHaveLength(1);
  });

  it('admin CAN insert a new prompt version (append-only)', async () => {
    const { data, error } = await clientA
      .from('prompt_versions')
      .insert({
        tenant_id: TENANT_A,
        compiled_prompt: 'append-only probe',
        config_snapshot: {},
        compiler_version: '0.0.0-test',
        vertical: 'generic',
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    // Cleanup must go through the superuser — clients can't delete, which is the point.
    await pool.query('delete from public.prompt_versions where id = $1', [data?.id]);
  });
});
