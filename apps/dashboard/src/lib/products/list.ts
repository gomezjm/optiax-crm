/**
 * Catalog reads (WS-D2 §1): applies a query plan to supabase-js. All access is
 * anon-key + session; RLS scopes every query to the tenant.
 *
 * Pagination is offset-based via `.range()`, same as the customers directory —
 * fine for MVP-scale catalogs (hundreds of products, not millions).
 */
import type { DashboardSupabaseClient } from '@/lib/supabase/types';
import { signMediaPaths } from '@/lib/media';
import type { ProductFilterModel } from './filter-model';
import { buildProductQueryPlan } from './query-translation';
import type { ProductCategoryRow, ProductRow, ProductsPage } from './types';

export async function fetchProductsPage(
  client: DashboardSupabaseClient,
  model: ProductFilterModel,
): Promise<ProductsPage> {
  const plan = buildProductQueryPlan(model);

  let query = client.from('products').select('*', { count: 'exact' });
  for (const filter of plan.filters) {
    query = query.filter(filter.column, filter.method, filter.value);
  }

  const { data, error, count } = await query
    .order(plan.sort.column, { ascending: plan.sort.ascending, nullsFirst: false })
    // Tiebreak on id so paging is stable when many rows share a sort value.
    .order('id', { ascending: true })
    .range(plan.rangeFrom, plan.rangeTo);
  if (error) throw error;

  const products = data ?? [];
  const signed = await signMediaPaths(
    client,
    products.flatMap((product) => product.image_paths),
  );

  return {
    items: products.map((product) => ({
      product,
      imageUrls: product.image_paths
        .map((path) => signed.get(path))
        .filter((url): url is string => url !== undefined),
    })),
    total: count ?? 0,
  };
}

/** Tenant's categories — filter bar, drawer select, inline creation (§1). */
export async function fetchProductCategories(
  client: DashboardSupabaseClient,
): Promise<ProductCategoryRow[]> {
  const { data, error } = await client.from('product_categories').select('*').order('name');
  if (error) throw error;
  return data;
}

/** One product, refreshed after an image upload/delete. */
export async function fetchProductById(
  client: DashboardSupabaseClient,
  productId: string,
): Promise<ProductRow | null> {
  const { data, error } = await client
    .from('products')
    .select('*')
    .eq('id', productId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * The whole catalog for the order composer's product picker. Unavailable
 * products are included on purpose — the owner may be logging an offline sale
 * of something they've stopped listing (§2); the picker warns instead of
 * hiding them.
 */
export async function fetchCatalogForPicker(
  client: DashboardSupabaseClient,
): Promise<Pick<ProductRow, 'id' | 'name' | 'price' | 'promo_price' | 'available'>[]> {
  const { data, error } = await client
    .from('products')
    .select('id, name, price, promo_price, available')
    .order('name');
  if (error) throw error;
  return data;
}
