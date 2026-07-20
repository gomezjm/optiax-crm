/**
 * /products — catalog (WS-D2 §1). Server component: parses URL filters, runs
 * the tenant-scoped queries (anon key + session; RLS scopes everything) and
 * hands the data to the interactive client. Same shape as /customers.
 */
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { toSearchParams } from '@/lib/search-params';
import { parseProductFilterModel } from '@/lib/products/filter-model';
import { fetchProductCategories, fetchProductsPage } from '@/lib/products/list';
import { ProductsClient } from './products-client';

export default async function ProductsPage({
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

  const [{ data: profile }, { data: tenant }, categories] = await Promise.all([
    supabase.from('profiles').select('tenant_id').eq('id', user.id).single(),
    supabase.from('tenants').select('currency').single(),
    fetchProductCategories(supabase),
  ]);
  if (!profile) redirect('/login');

  const model = parseProductFilterModel(toSearchParams(rawParams));
  const page = await fetchProductsPage(supabase, model);

  return (
    <ProductsClient
      tenantId={profile.tenant_id}
      currency={tenant?.currency ?? 'COP'}
      categories={categories}
      model={model}
      page={page}
    />
  );
}
