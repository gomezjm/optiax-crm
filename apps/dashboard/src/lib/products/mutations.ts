/**
 * Catalog writes (WS-D2 §1). Products and categories are sales_rep-writable by
 * ratified decision (phase-0 §11) — D2 keeps that; the drawer is reachable by
 * both roles.
 */
import { ProductCategorySchema, ProductSchema, type Product } from '@optiax/shared';
import type { DashboardSupabaseClient } from '@/lib/supabase/types';
import type { ProductCategoryRow, ProductRow } from './types';

/**
 * Column payload for both insert and update. The return type is inferred on
 * purpose: annotating it `ProductUpdate` would make every field optional and
 * an insert (which requires name + price) would stop typechecking.
 */
function productToColumns(product: Product) {
  return {
    name: product.name,
    description: product.description,
    category_id: product.category_id,
    price: product.price,
    promo_price: product.promo_price,
    available: product.available,
    image_paths: product.image_paths,
  };
}

export async function createProduct(
  client: DashboardSupabaseClient,
  tenantId: string,
  input: Product,
): Promise<ProductRow> {
  const parsed = ProductSchema.parse(input);
  const { data, error } = await client
    .from('products')
    .insert({ tenant_id: tenantId, ...productToColumns(parsed) })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateProduct(
  client: DashboardSupabaseClient,
  productId: string,
  input: Product,
): Promise<ProductRow> {
  const parsed = ProductSchema.parse(input);
  const { data, error } = await client
    .from('products')
    .update(productToColumns(parsed))
    .eq('id', productId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * The list-row availability toggle (§1) — the "stop selling this NOW" action.
 * Deliberately its own narrow write: it must not depend on the drawer form
 * being valid, because the panic case is one click from the list.
 */
export async function setProductAvailability(
  client: DashboardSupabaseClient,
  productId: string,
  available: boolean,
): Promise<void> {
  const { error } = await client.from('products').update({ available }).eq('id', productId);
  if (error) throw error;
}

/**
 * Image paths only. Narrow like the availability toggle and for the same
 * reason: the blob is already in Storage by the time this runs, so persisting
 * it must not depend on the rest of the drawer form being valid.
 */
export async function setProductImages(
  client: DashboardSupabaseClient,
  productId: string,
  imagePaths: string[],
): Promise<void> {
  const { error } = await client
    .from('products')
    .update({ image_paths: imagePaths })
    .eq('id', productId);
  if (error) throw error;
}

/** Postgres foreign-key violation — a product still referenced by order_items. */
const FK_VIOLATION = '23503';

export type DeleteProductResult = { outcome: 'deleted' } | { outcome: 'referenced' };

/**
 * Products that appear on an order can never be deleted: order history has to
 * keep pointing at what was actually sold. The FK refuses, we catch that one
 * code and the UI offers "marcar no disponible" instead (§1).
 */
export async function deleteProduct(
  client: DashboardSupabaseClient,
  productId: string,
): Promise<DeleteProductResult> {
  const { error } = await client.from('products').delete().eq('id', productId);
  if (!error) return { outcome: 'deleted' };
  if (error.code === FK_VIOLATION) return { outcome: 'referenced' };
  throw error;
}

export async function createProductCategory(
  client: DashboardSupabaseClient,
  tenantId: string,
  name: string,
): Promise<ProductCategoryRow> {
  const parsed = ProductCategorySchema.parse({ name });
  const { data, error } = await client
    .from('product_categories')
    .insert({ tenant_id: tenantId, name: parsed.name })
    .select()
    .single();
  if (error) throw error;
  return data;
}
