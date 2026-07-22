/**
 * /segments — customer segments (ws-c1 §2, PRD Screen 2). Server component:
 * loads the tenant's segments with a live member count each (evaluated through
 * the shared engine, never materialized) and hands them to the interactive
 * client. All reads are anon-key + session; RLS scopes everything to the tenant.
 */
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { fetchEnabledAttributeDefs, fetchTags } from '@/lib/customers/list';
import {
  buildEvalContext,
  fetchSegmentsWithCounts,
  fetchTenantTimeZone,
} from '@/lib/segments/queries';
import { SegmentsClient } from './segments-client';

export default async function SegmentsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: profile }, { data: tenant }, defs, tags, timeZone] = await Promise.all([
    supabase.from('profiles').select('tenant_id, role').eq('id', user.id).single(),
    supabase.from('tenants').select('currency').single(),
    fetchEnabledAttributeDefs(supabase),
    fetchTags(supabase),
    fetchTenantTimeZone(supabase),
  ]);
  if (!profile) redirect('/login');

  const ctx = buildEvalContext(timeZone, defs);
  const items = await fetchSegmentsWithCounts(supabase, ctx);

  return (
    <SegmentsClient
      tenantId={profile.tenant_id}
      isAdmin={profile.role === 'admin'}
      timeZone={timeZone}
      currency={tenant?.currency ?? 'COP'}
      defs={defs}
      tags={tags}
      items={items}
    />
  );
}
