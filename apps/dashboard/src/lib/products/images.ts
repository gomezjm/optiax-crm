/**
 * Product image pipeline (WS-D2 §1): downscale in the browser, then upload to
 * the private `media` bucket under `{tenant_id}/products/{product_id}/`.
 *
 * Downscaling is not a nicety — these images get sent over WhatsApp to
 * customers on LatAm mobile data, and owners upload straight from a phone
 * camera (4–12 MP). Canvas does it with no new dependency.
 */
import { PRODUCT_IMAGE_MAX_EDGE, PRODUCT_MAX_IMAGES } from '@optiax/shared';
import { MEDIA_BUCKET } from '@/lib/media';
import type { DashboardSupabaseClient } from '@/lib/supabase/types';

export { PRODUCT_MAX_IMAGES };

/** JPEG quality for the downscaled upload — visually clean, ~200-400 KB. */
const JPEG_QUALITY = 0.85;

/**
 * Target dimensions preserving aspect ratio, never upscaling. Pure, so the
 * sizing rule is unit-testable without a DOM.
 */
export function scaledDimensions(
  width: number,
  height: number,
  maxEdge: number = PRODUCT_IMAGE_MAX_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest === 0) {
    return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  }
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Browser-only: decode → downscale → re-encode as JPEG. */
export async function downscaleToJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = scaledDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas 2d context unavailable');
    context.drawImage(bitmap, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('canvas toBlob returned null'))),
        'image/jpeg',
        JPEG_QUALITY,
      );
    });
  } finally {
    bitmap.close();
  }
}

/**
 * Storage keys are always tenant-prefixed — storage RLS enforces it, and
 * building the path in one place keeps every caller honest.
 */
export function productImagePath(tenantId: string, productId: string, fileName: string): string {
  return `${tenantId}/products/${productId}/${fileName}`;
}

export function orderProofPath(tenantId: string, orderId: string, fileName: string): string {
  return `${tenantId}/orders/${orderId}/${fileName}`;
}

/** Downscale + upload one product image; returns the stored path. */
export async function uploadProductImage(
  client: DashboardSupabaseClient,
  tenantId: string,
  productId: string,
  file: File,
): Promise<string> {
  const blob = await downscaleToJpeg(file);
  const path = productImagePath(tenantId, productId, `${crypto.randomUUID()}.jpg`);
  const { error } = await client.storage
    .from(MEDIA_BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
  return path;
}

/** Downscale + upload a payment proof for an order (§2); returns the path. */
export async function uploadOrderProof(
  client: DashboardSupabaseClient,
  tenantId: string,
  orderId: string,
  file: File,
): Promise<string> {
  const blob = await downscaleToJpeg(file);
  const path = orderProofPath(tenantId, orderId, `${crypto.randomUUID()}.jpg`);
  const { error } = await client.storage
    .from(MEDIA_BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
  return path;
}

/**
 * Best-effort removal of the stored object. The product row is the source of
 * truth for what's shown, so a failed delete leaves an orphan blob rather than
 * blocking the user from dropping the image from the listing.
 */
export async function removeMediaObject(
  client: DashboardSupabaseClient,
  path: string,
): Promise<void> {
  await client.storage.from(MEDIA_BUCKET).remove([path]);
}
