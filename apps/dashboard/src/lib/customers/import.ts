/**
 * CSV import batch (WS-D1 §6): dedupe against existing (tenant, phone/wa_id)
 * → skip, never overwrite; `source: 'import'` on every insert; per-row error
 * isolation (a failing chunk retries row-by-row).
 */
import {
  IMPORT_MAX_ROWS,
  normalizeCustomerPhone,
  type CustomerImportRow,
  type Json,
} from '@optiax/shared';
import type { DashboardSupabaseClient } from '@/lib/supabase/types';
import { fetchPhoneIndex, findDuplicateByPhone } from './mutations';

export { IMPORT_MAX_ROWS };

export interface ImportRowRef {
  /** 1-based data row number (header excluded), for user-facing reports. */
  rowNumber: number;
  row: CustomerImportRow;
}

export interface ImportResult {
  imported: number;
  skipped: { rowNumber: number; row: CustomerImportRow; existingName: string | null }[];
  failed: { rowNumber: number; row: CustomerImportRow; reason: string }[];
}

const CHUNK_SIZE = 100;

export async function importCustomers(
  client: DashboardSupabaseClient,
  tenantId: string,
  rows: ImportRowRef[],
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
  const result: ImportResult = { imported: 0, skipped: [], failed: [] };
  const index = await fetchPhoneIndex(client);
  const seenInFile = new Set<string>();
  const toInsert: ImportRowRef[] = [];

  for (const ref of rows.slice(0, IMPORT_MAX_ROWS)) {
    const digits = normalizeCustomerPhone(ref.row.phone);
    const existing = findDuplicateByPhone(index, ref.row.phone);
    if (existing) {
      result.skipped.push({ rowNumber: ref.rowNumber, row: ref.row, existingName: existing.name });
      continue;
    }
    if (seenInFile.has(digits)) {
      result.skipped.push({ rowNumber: ref.rowNumber, row: ref.row, existingName: null });
      continue;
    }
    seenInFile.add(digits);
    toInsert.push(ref);
  }

  const total = toInsert.length;
  let done = 0;

  const insertPayload = (ref: ImportRowRef) => ({
    tenant_id: tenantId,
    source: 'import' as const,
    name: ref.row.name,
    // Store the normalized digit form — import is the one path where we
    // control formatting, and digits keep future dedupes exact.
    phone: normalizeCustomerPhone(ref.row.phone),
    email: ref.row.email ?? null,
    address: ref.row.address ?? null,
    city: ref.row.city ?? null,
    gender: ref.row.gender ?? null,
    age_group: ref.row.age_group ?? null,
    consent_status: ref.row.consent_status,
    attributes: ref.row.attributes as Json,
  });

  for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
    const chunk = toInsert.slice(i, i + CHUNK_SIZE);
    const { error } = await client.from('customers').insert(chunk.map(insertPayload));
    if (!error) {
      result.imported += chunk.length;
    } else {
      // Isolate the failing row(s) so one bad row doesn't sink 99 good ones.
      for (const ref of chunk) {
        const { error: rowError } = await client.from('customers').insert(insertPayload(ref));
        if (rowError) {
          result.failed.push({ rowNumber: ref.rowNumber, row: ref.row, reason: rowError.message });
        } else {
          result.imported += 1;
        }
      }
    }
    done += chunk.length;
    onProgress?.(done, total);
  }

  return result;
}
