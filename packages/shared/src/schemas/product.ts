import { z } from 'zod';

/**
 * Product + category contracts (WS-D2 §1). The dashboard catalog screen writes
 * through these today; R2's `check_catalog` agent tool reads the same shapes,
 * which is why they live here rather than in the dashboard.
 */

/**
 * Up to two images per product — they get sent over WhatsApp, where a third
 * attachment is noise rather than help.
 */
export const PRODUCT_MAX_IMAGES = 2;

/** Longest edge (px) an uploaded product image is downscaled to before upload. */
export const PRODUCT_IMAGE_MAX_EDGE = 1600;

/** Storage object paths, always `{tenant_id}/products/{product_id}/{file}`. */
const imagePathField = z.string().trim().min(1).max(400);

export const ProductCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
  })
  .strict();
export type ProductCategory = z.infer<typeof ProductCategorySchema>;

/**
 * Editable surface of a product row. `tenant_id`, `id` and the `updated_at`
 * trigger column are not part of it — the write site supplies the tenant.
 */
export const ProductSchema = z
  .object({
    name: z.string().trim().min(1).max(140),
    description: z.string().trim().max(1000).nullable(),
    category_id: z.string().uuid().nullable(),
    price: z.number().finite().nonnegative(),
    promo_price: z.number().finite().nonnegative().nullable(),
    available: z.boolean(),
    image_paths: z.array(imagePathField).max(PRODUCT_MAX_IMAGES),
  })
  .strict()
  .superRefine((product, ctx) => {
    // A promo price at or above the regular price is always a typo, and the
    // list renders it as a strikethrough discount — so it would read as a lie.
    if (product.promo_price !== null && product.promo_price >= product.price) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['promo_price'],
        message: 'promo_price must be lower than price',
      });
    }
  });
export type Product = z.infer<typeof ProductSchema>;

/**
 * Price a new order line should prefill with: the promo when one is set,
 * otherwise the regular price. Shared so the order composer and the agent
 * quote the same number.
 */
export function effectivePrice(product: { price: number; promo_price: number | null }): number {
  return product.promo_price ?? product.price;
}
