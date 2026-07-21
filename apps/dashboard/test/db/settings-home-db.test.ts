/**
 * DB-backed tests for the D4 Settings masters + Home snapshot (WS-D4 §4) against
 * local seeded Supabase. Proves the RLS surface the screens rely on — admin can
 * write every master, a sales_rep is blocked (canary) — plus the guards
 * (last-admin, verified_by) and the Home aggregates against known seed numbers.
 *
 * Uses TENANT_A (Moda Valentina). A service client makes authoritative reads and
 * restores any seed rows the tests mutate. Runs via `pnpm db:test`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@optiax/shared';
import { fetchSettingsData } from '../../src/lib/settings/queries';
import {
  LastAdminError,
  createAttributeDef,
  deleteAttributeDef,
  createPaymentMethod,
  renameOrderStatus,
  reorderOrderStatuses,
  updateMemberRole,
} from '../../src/lib/settings/mutations';
import { fetchHomeSnapshot } from '../../src/lib/home/queries';
import { fetchOrderMasters } from '../../src/lib/orders/list';
import { setPaymentVerified } from '../../src/lib/orders/mutations';
import { fetchVerifierName } from '../../src/lib/orders/list';

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
let repUserId: string;

async function signIn(email: string): Promise<{ client: SupabaseClient<Database>; userId: string }> {
  const client = createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password: SEED_PASSWORD });
  if (error || !data.user) throw new Error(`signIn(${email}): ${error?.message ?? 'no user'}`);
  return { client, userId: data.user.id };
}

beforeAll(async () => {
  ({ client: admin, userId: adminUserId } = await signIn(ADMIN_A));
  ({ client: rep, userId: repUserId } = await signIn(REP_A));
  service = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
});

afterAll(async () => {
  // Restore any seed rows the tests touched.
  await service.from('attribute_defs').delete().eq('tenant_id', TENANT_A).eq('key', 'd4_test_attr');
  await service.from('payment_methods').delete().eq('tenant_id', TENANT_A).eq('label', 'D4 Test PM');
  await service.from('profiles').update({ role: 'sales_rep' }).eq('id', repUserId);
  await service.from('profiles').update({ role: 'admin' }).eq('id', adminUserId);
  await service
    .from('orders')
    .update({ payment_verified_at: null, verified_by: null })
    .eq('id', 'aa000000-0040-4000-8000-000000000001');
  await service.from('orders').delete().eq('tenant_id', TENANT_A).eq('payment_reference', 'D4-TODAY');
  await service.from('orders').delete().eq('tenant_id', TENANT_A).eq('payment_reference', 'D4-TODAY-CANCEL');
  await admin.auth.signOut();
  await rep.auth.signOut();
});

describe('attribute_defs — admin-write (RLS canary)', () => {
  it('an admin can create then delete a def; a rep cannot create', async () => {
    await createAttributeDef(admin, TENANT_A, {
      key: 'd4_test_attr',
      label: 'D4 Test',
      type: 'text',
      options: null,
      enabled: true,
    });
    const { data: created } = await service
      .from('attribute_defs')
      .select('id')
      .eq('tenant_id', TENANT_A)
      .eq('key', 'd4_test_attr')
      .maybeSingle();
    expect(created).not.toBeNull();

    await expect(
      createAttributeDef(rep, TENANT_A, {
        key: 'rep_should_fail',
        label: 'Nope',
        type: 'text',
        options: null,
        enabled: true,
      }),
    ).rejects.toBeTruthy();

    if (created) await deleteAttributeDef(admin, created.id);
    const { data: gone } = await service
      .from('attribute_defs')
      .select('id')
      .eq('id', created!.id)
      .maybeSingle();
    expect(gone).toBeNull();
  });
});

describe('order_statuses — rename + reorder', () => {
  it('rename persists and orders reflect the new label', async () => {
    const { data: nuevo } = await service
      .from('order_statuses')
      .select('id, name, sort_order')
      .eq('tenant_id', TENANT_A)
      .eq('kind', 'new')
      .single();
    const originalName = nuevo!.name;
    try {
      await renameOrderStatus(admin, nuevo!.id, 'Por confirmar');
      const masters = await fetchOrderMasters(admin);
      const renamed = masters.statuses.find((s) => s.id === nuevo!.id);
      expect(renamed?.name).toBe('Por confirmar');
      expect(renamed?.kind).toBe('new'); // kind never changes
    } finally {
      await service.from('order_statuses').update({ name: originalName }).eq('id', nuevo!.id);
    }
  });

  it('a rep cannot rename a status (RLS no-ops the write)', async () => {
    const { data: s } = await service
      .from('order_statuses')
      .select('id, name')
      .eq('tenant_id', TENANT_A)
      .eq('kind', 'processing')
      .single();
    // The admin_write UPDATE policy's USING clause hides the row from a rep, so
    // the write affects 0 rows and PostgREST reports no error — the security
    // outcome is that the label is unchanged, which is what we assert.
    await renameOrderStatus(rep, s!.id, 'Hackeado');
    const { data: after } = await service
      .from('order_statuses')
      .select('name')
      .eq('id', s!.id)
      .single();
    expect(after!.name).toBe(s!.name);
  });

  it('reorder persists new sort_order values', async () => {
    const { data: statuses } = await service
      .from('order_statuses')
      .select('id, sort_order')
      .eq('tenant_id', TENANT_A)
      .order('sort_order');
    const original = statuses!.map((s) => ({ id: s.id, sort_order: s.sort_order }));
    // Reverse the ordering, then restore.
    const reversed = original.map((s, i) => ({ id: s.id, sort_order: original.length - i }));
    try {
      await reorderOrderStatuses(admin, reversed);
      const { data: after } = await service
        .from('order_statuses')
        .select('id, sort_order')
        .eq('tenant_id', TENANT_A);
      const byId = new Map(after!.map((s) => [s.id, s.sort_order]));
      for (const r of reversed) expect(byId.get(r.id)).toBe(r.sort_order);
    } finally {
      await reorderOrderStatuses(service, original);
    }
  });
});

describe('payment_methods — admin-write (canary)', () => {
  it('an admin can create a method; a rep cannot', async () => {
    await createPaymentMethod(admin, TENANT_A, {
      label: 'D4 Test PM',
      details: 'cuenta 123',
      enabled: true,
    });
    const { data } = await service
      .from('payment_methods')
      .select('id')
      .eq('tenant_id', TENANT_A)
      .eq('label', 'D4 Test PM')
      .maybeSingle();
    expect(data).not.toBeNull();

    await expect(
      createPaymentMethod(rep, TENANT_A, { label: 'Rep PM', details: 'x', enabled: true }),
    ).rejects.toBeTruthy();
  });
});

describe('team roles — last-admin guard + role change', () => {
  it('refuses to demote the last admin', async () => {
    const data = await fetchSettingsData(admin, adminUserId);
    // Seed: exactly one admin (Valentina) in TENANT_A.
    await expect(
      updateMemberRole(admin, data.team, adminUserId, 'sales_rep'),
    ).rejects.toBeInstanceOf(LastAdminError);
  });

  it('an admin can promote a rep and demote them back', async () => {
    let data = await fetchSettingsData(admin, adminUserId);
    await updateMemberRole(admin, data.team, repUserId, 'admin');
    let { data: promoted } = await service.from('profiles').select('role').eq('id', repUserId).single();
    expect(promoted!.role).toBe('admin');

    // Now two admins exist, so the original admin could be demoted — but restore instead.
    data = await fetchSettingsData(admin, adminUserId);
    await updateMemberRole(admin, data.team, repUserId, 'sales_rep');
    ({ data: promoted } = await service.from('profiles').select('role').eq('id', repUserId).single());
    expect(promoted!.role).toBe('sales_rep');
  });
});

describe('verified_by (§0.1)', () => {
  it('records the acting user and resolves their name', async () => {
    const orderId = 'aa000000-0040-4000-8000-000000000001'; // awaiting_verification seed order
    await setPaymentVerified(admin, orderId, true);
    const { data } = await service
      .from('orders')
      .select('verified_by, payment_verified_at')
      .eq('id', orderId)
      .single();
    expect(data!.verified_by).toBe(adminUserId);
    expect(data!.payment_verified_at).not.toBeNull();

    const name = await fetchVerifierName(admin, data!.verified_by);
    expect(name).toBe('Valentina García');

    // Unverify clears both.
    await setPaymentVerified(admin, orderId, false);
    const { data: cleared } = await service
      .from('orders')
      .select('verified_by, payment_verified_at')
      .eq('id', orderId)
      .single();
    expect(cleared!.verified_by).toBeNull();
    expect(cleared!.payment_verified_at).toBeNull();
  });
});

describe('Home snapshot — seed aggregates (§1)', () => {
  it('matches the known seed numbers for TENANT_A', async () => {
    const snap = await fetchHomeSnapshot(admin, 'America/Bogota');
    expect(snap.pedidosPendientes).toBe(1); // only the awaiting_verification order
    expect(snap.accionNecesaria).toBe(2); // 1 needs_attention convo + 1 awaiting_verification order
    expect(snap.campanasActivas).toBeNull();
    expect(snap.verificationOrders.length).toBe(1);
    expect(snap.attentionConversations.length).toBe(1);
  });

  it('Ventas de hoy sums today\'s non-cancelled orders in tenant tz', async () => {
    const { data: customer } = await service
      .from('customers')
      .select('id')
      .eq('tenant_id', TENANT_A)
      .limit(1)
      .single();
    const { data: newStatus } = await service
      .from('order_statuses')
      .select('id')
      .eq('tenant_id', TENANT_A)
      .eq('kind', 'new')
      .single();
    const { data: cancelledStatus } = await service
      .from('order_statuses')
      .select('id')
      .eq('tenant_id', TENANT_A)
      .eq('kind', 'cancelled')
      .single();

    const baseline = (await fetchHomeSnapshot(admin, 'America/Bogota')).ventasDeHoy;

    await service.from('orders').insert([
      {
        tenant_id: TENANT_A,
        customer_id: customer!.id,
        status_id: newStatus!.id,
        total: 50000,
        currency: 'COP',
        source: 'manual',
        payment_reference: 'D4-TODAY',
      },
      {
        // Cancelled today → excluded from Ventas de hoy.
        tenant_id: TENANT_A,
        customer_id: customer!.id,
        status_id: cancelledStatus!.id,
        total: 99999,
        currency: 'COP',
        source: 'manual',
        payment_reference: 'D4-TODAY-CANCEL',
      },
    ]);

    const after = (await fetchHomeSnapshot(admin, 'America/Bogota')).ventasDeHoy;
    expect(after).toBe(baseline + 50000);

    await service.from('orders').delete().eq('tenant_id', TENANT_A).eq('payment_reference', 'D4-TODAY');
    await service.from('orders').delete().eq('tenant_id', TENANT_A).eq('payment_reference', 'D4-TODAY-CANCEL');
  });
});
