import { describe, expect, it } from 'vitest';
import {
  effectivePrice,
  PRODUCT_MAX_IMAGES,
  ProductCategorySchema,
  ProductSchema,
} from '../src/schemas/product.js';

const baseProduct = {
  name: 'Blusa de lino Manuela',
  description: 'Blusa de lino manga corta.',
  category_id: '11111111-1111-4111-8111-111111111111',
  price: 89000,
  promo_price: null,
  available: true,
  image_paths: [],
};

describe('ProductSchema', () => {
  it('accepts a well-formed product', () => {
    expect(ProductSchema.parse(baseProduct)).toEqual(baseProduct);
  });

  it('allows the nullable fields to be null', () => {
    const parsed = ProductSchema.parse({
      ...baseProduct,
      description: null,
      category_id: null,
    });
    expect(parsed.description).toBeNull();
    expect(parsed.category_id).toBeNull();
  });

  it('accepts a promo strictly below the price', () => {
    expect(ProductSchema.parse({ ...baseProduct, promo_price: 75000 }).promo_price).toBe(75000);
  });

  it('rejects a promo equal to the price', () => {
    const result = ProductSchema.safeParse({ ...baseProduct, promo_price: 89000 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['promo_price']);
    }
  });

  it('rejects a promo above the price', () => {
    const result = ProductSchema.safeParse({ ...baseProduct, promo_price: 99000 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['promo_price']);
    }
  });

  it('rejects a negative price', () => {
    expect(ProductSchema.safeParse({ ...baseProduct, price: -1 }).success).toBe(false);
  });

  it('rejects an empty name', () => {
    expect(ProductSchema.safeParse({ ...baseProduct, name: '   ' }).success).toBe(false);
  });

  it(`rejects more than ${PRODUCT_MAX_IMAGES} images`, () => {
    const tooMany = Array.from({ length: PRODUCT_MAX_IMAGES + 1 }, (_, i) => `t/products/p/${i}.jpg`);
    expect(ProductSchema.safeParse({ ...baseProduct, image_paths: tooMany }).success).toBe(false);
  });

  it(`accepts exactly ${PRODUCT_MAX_IMAGES} images`, () => {
    const exact = Array.from({ length: PRODUCT_MAX_IMAGES }, (_, i) => `t/products/p/${i}.jpg`);
    expect(ProductSchema.safeParse({ ...baseProduct, image_paths: exact }).success).toBe(true);
  });

  it('rejects unknown keys (strict)', () => {
    expect(ProductSchema.safeParse({ ...baseProduct, stock: 5 }).success).toBe(false);
  });

  it('trims the name', () => {
    expect(ProductSchema.parse({ ...baseProduct, name: '  Jean  ' }).name).toBe('Jean');
  });
});

describe('ProductCategorySchema', () => {
  it('trims and accepts a name', () => {
    expect(ProductCategorySchema.parse({ name: '  Blusas ' })).toEqual({ name: 'Blusas' });
  });

  it('rejects a blank name', () => {
    expect(ProductCategorySchema.safeParse({ name: '  ' }).success).toBe(false);
  });
});

describe('effectivePrice', () => {
  it('prefers the promo price when one is set', () => {
    expect(effectivePrice({ price: 89000, promo_price: 75000 })).toBe(75000);
  });

  it('falls back to the regular price', () => {
    expect(effectivePrice({ price: 89000, promo_price: null })).toBe(89000);
  });

  it('treats a zero promo as a real promo, not as missing', () => {
    expect(effectivePrice({ price: 89000, promo_price: 0 })).toBe(0);
  });
});
