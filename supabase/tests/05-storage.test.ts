/**
 * §9.5 Storage: tenant-A user cannot read/write `{tenant_b_id}/...` paths in the
 * private `media` bucket; own-prefix read/write works.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { TENANT_A, TENANT_B, USERS, signIn } from './helpers.js';

let clientA: SupabaseClient;
const ownPath = `${TENANT_A}/tests/isolation-probe.txt`;
const foreignPath = `${TENANT_B}/tests/isolation-probe.txt`;
const fileBody = new Blob(['isolation probe'], { type: 'text/plain' });

beforeAll(async () => {
  clientA = await signIn(USERS.adminA);
});

afterAll(async () => {
  await clientA.storage.from('media').remove([ownPath]);
  await clientA.auth.signOut();
});

describe('storage tenant-prefix isolation (media bucket)', () => {
  it('tenant A can upload under its own prefix', async () => {
    const { error } = await clientA.storage.from('media').upload(ownPath, fileBody, {
      upsert: true,
    });
    expect(error).toBeNull();
  });

  it('tenant A can read back its own object', async () => {
    const { data, error } = await clientA.storage.from('media').download(ownPath);
    expect(error).toBeNull();
    expect(await data?.text()).toBe('isolation probe');
  });

  it("tenant A cannot upload under tenant B's prefix", async () => {
    const { error } = await clientA.storage.from('media').upload(foreignPath, fileBody, {
      upsert: true,
    });
    expect(error).not.toBeNull();
  });

  it("tenant A cannot download from tenant B's prefix", async () => {
    const { data, error } = await clientA.storage.from('media').download(foreignPath);
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("tenant A listing tenant B's prefix sees nothing", async () => {
    const { data, error } = await clientA.storage.from('media').list(`${TENANT_B}/tests`);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("tenant A cannot delete under tenant B's prefix", async () => {
    // remove() succeeds with an empty result when RLS hides the object.
    const { data, error } = await clientA.storage.from('media').remove([foreignPath]);
    if (error === null) {
      expect(data).toEqual([]);
    } else {
      expect(data ?? []).toEqual([]);
    }
  });

  it('the media bucket is private (no public URL access)', async () => {
    const { data } = clientA.storage.from('media').getPublicUrl(ownPath);
    const res = await fetch(data.publicUrl);
    expect(res.ok).toBe(false);
  });
});
