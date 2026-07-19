/**
 * Mass edit (WS-D1 §5): batched updates over a bounded selection (≤500),
 * chunks of 100, per-chunk error tolerance. No mass delete by design.
 */
import { MASS_EDIT_MAX_ROWS, type AttributeValue, type Json } from '@optiax/shared';
import type { DashboardSupabaseClient } from '@/lib/supabase/types';
import type { ConsentStatus } from './types';

export { MASS_EDIT_MAX_ROWS };

export type MassEditAction =
  | { kind: 'add_tags'; tagIds: string[] }
  | { kind: 'remove_tags'; tagIds: string[] }
  | { kind: 'set_attribute'; key: string; value: AttributeValue | null }
  | { kind: 'set_consent'; consent: ConsentStatus };

export interface MassEditResult {
  updated: number;
  errors: number;
}

const CHUNK_SIZE = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function massEdit(
  client: DashboardSupabaseClient,
  tenantId: string,
  customerIds: string[],
  action: MassEditAction,
  onProgress?: (done: number, total: number) => void,
): Promise<MassEditResult> {
  const ids = customerIds.slice(0, MASS_EDIT_MAX_ROWS);
  const total = ids.length;
  let updated = 0;
  let errors = 0;
  let done = 0;

  for (const idChunk of chunk(ids, CHUNK_SIZE)) {
    try {
      switch (action.kind) {
        case 'add_tags': {
          const rows = idChunk.flatMap((customerId) =>
            action.tagIds.map((tagId) => ({
              tenant_id: tenantId,
              customer_id: customerId,
              tag_id: tagId,
            })),
          );
          const { error } = await client
            .from('customer_tags')
            .upsert(rows, { onConflict: 'customer_id,tag_id', ignoreDuplicates: true });
          if (error) throw error;
          updated += idChunk.length;
          break;
        }
        case 'remove_tags': {
          const { error } = await client
            .from('customer_tags')
            .delete()
            .in('customer_id', idChunk)
            .in('tag_id', action.tagIds);
          if (error) throw error;
          updated += idChunk.length;
          break;
        }
        case 'set_consent': {
          const { error } = await client
            .from('customers')
            .update({ consent_status: action.consent })
            .in('id', idChunk);
          if (error) throw error;
          updated += idChunk.length;
          break;
        }
        case 'set_attribute': {
          // jsonb merge isn't expressible through PostgREST updates, so
          // read-modify-write per row (bounded by the 500 cap).
          const { data, error } = await client
            .from('customers')
            .select('id, attributes')
            .in('id', idChunk);
          if (error) throw error;
          for (const row of data) {
            const attributes = {
              ...(typeof row.attributes === 'object' && row.attributes !== null
                ? (row.attributes as Record<string, Json>)
                : {}),
            };
            if (action.value === null) {
              delete attributes[action.key];
            } else {
              attributes[action.key] = action.value;
            }
            const { error: updateError } = await client
              .from('customers')
              .update({ attributes: attributes as Json })
              .eq('id', row.id);
            if (updateError) {
              errors += 1;
            } else {
              updated += 1;
            }
          }
          break;
        }
      }
    } catch {
      errors += idChunk.length;
    }
    done += idChunk.length;
    onProgress?.(done, total);
  }

  return { updated, errors };
}
