/**
 * Signed URLs for the private `media` bucket, shared by the catalog thumbnails
 * and the order payment proofs.
 *
 * Storage RLS already scopes every object to a `{tenant_id}/…` prefix, so
 * signing only ever hands back a URL for something the caller could download
 * anyway. Signing failures are swallowed and surface as a missing image: a
 * thumbnail is decoration, and blanking a whole list because one object was
 * deleted out from under it would be a worse failure than a broken tile.
 */
import type { DashboardSupabaseClient } from '@/lib/supabase/types';

export const MEDIA_BUCKET = 'media';

/** Long enough for a working session, short enough that a leaked URL expires. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export async function signMediaPaths(
  client: DashboardSupabaseClient,
  paths: readonly string[],
): Promise<Map<string, string>> {
  const signed = new Map<string, string>();
  const unique = [...new Set(paths.filter((path) => path.length > 0))];
  if (unique.length === 0) return signed;

  const { data, error } = await client.storage
    .from(MEDIA_BUCKET)
    .createSignedUrls(unique, SIGNED_URL_TTL_SECONDS);
  if (error) return signed;

  for (const row of data ?? []) {
    if (row.error === null && row.path !== null && row.signedUrl) {
      signed.set(row.path, row.signedUrl);
    }
  }
  return signed;
}

/** One path — the drawer's payment proof / product image previews. */
export async function signMediaPath(
  client: DashboardSupabaseClient,
  path: string | null,
): Promise<string | null> {
  if (!path) return null;
  const signed = await signMediaPaths(client, [path]);
  return signed.get(path) ?? null;
}
