import type { Database } from '@optiax/shared';

export type ProductRow = Database['public']['Tables']['products']['Row'];
export type ProductInsert = Database['public']['Tables']['products']['Insert'];
export type ProductUpdate = Database['public']['Tables']['products']['Update'];
export type ProductCategoryRow = Database['public']['Tables']['product_categories']['Row'];

/** A product plus the signed URLs its stored image paths resolve to. */
export interface ProductListItem {
  product: ProductRow;
  /** Same order as `product.image_paths`; a path that failed to sign is dropped. */
  imageUrls: string[];
}

export interface ProductsPage {
  items: ProductListItem[];
  /** Total rows matching the filter (for pagination). */
  total: number;
}
