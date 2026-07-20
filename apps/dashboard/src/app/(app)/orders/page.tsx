/**
 * /orders — order management (WS-D2 §2). Server component: parses URL filters,
 * runs the tenant-scoped queries (anon key + session; RLS scopes everything)
 * and hands the data to the interactive client.
 */
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { toSearchParams } from '@/lib/search-params';
import { parseOrderFilterModel } from '@/lib/orders/filter-model';
import { fetchOrderMasters, fetchOrdersPage } from '@/lib/orders/list';
import { OrdersClient } from './orders-client';

export default async function OrdersPage({
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

  const [{ data: profile }, { data: tenant }, masters] = await Promise.all([
    supabase.from('profiles').select('tenant_id').eq('id', user.id).single(),
    supabase.from('tenants').select('currency').single(),
    fetchOrderMasters(supabase),
  ]);
  if (!profile) redirect('/login');

  const model = parseOrderFilterModel(toSearchParams(rawParams));
  const page = await fetchOrdersPage(supabase, model);

  return (
    <OrdersClient
      tenantId={profile.tenant_id}
      currency={tenant?.currency ?? 'COP'}
      masters={masters}
      model={model}
      page={page}
    />
  );
}
