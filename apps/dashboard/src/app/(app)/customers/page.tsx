/**
 * /customers — directory (WS-D1 §2). Server component: parses URL filters,
 * runs the tenant-scoped queries (anon key + session; RLS scopes everything)
 * and hands the data to the interactive client. The URL is the single source
 * of truth for search/filters/sort/page, so views are shareable.
 */
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { parseFilterModel } from '@/lib/customers/filter-model';
import { fetchCustomersPage, fetchEnabledAttributeDefs, fetchTags } from '@/lib/customers/list';
import { CustomersClient } from './customers-client';

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const rawParams = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: profile }, { data: tenant }, defs, tags] = await Promise.all([
    supabase.from('profiles').select('tenant_id').eq('id', user.id).single(),
    supabase.from('tenants').select('currency').single(),
    fetchEnabledAttributeDefs(supabase),
    fetchTags(supabase),
  ]);
  if (!profile) redirect('/login');

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(rawParams)) {
    if (typeof value === 'string') params.set(key, value);
    else if (Array.isArray(value) && value[0] !== undefined) params.set(key, value[0]);
  }
  const model = parseFilterModel(params, defs);
  const page = await fetchCustomersPage(supabase, model);

  return (
    <CustomersClient
      tenantId={profile.tenant_id}
      currency={tenant?.currency ?? 'COP'}
      defs={defs}
      tags={tags}
      model={model}
      page={page}
    />
  );
}
