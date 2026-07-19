/**
 * Type-aware conversion of raw strings (CSV cells, drawer inputs) into
 * attribute values per attribute_def. Pure + unit-tested.
 */
import type { AttributeValue } from '@optiax/shared';
import { selectOptions, type AttributeDefRow } from './types';

export type ConvertResult =
  | { ok: true; value: AttributeValue }
  | { ok: true; value: undefined /* blank cell → attribute not set */ }
  | { ok: false; reason: 'invalid_number' | 'invalid_date' | 'invalid_boolean' | 'invalid_option' };

const TRUE_WORDS = new Set(['true', 'si', 'sí', 'yes', '1', 'x']);
const FALSE_WORDS = new Set(['false', 'no', '0']);

/** DD/MM/YYYY or DD-MM-YYYY → YYYY-MM-DD; ISO passes through. */
function toIsoDate(raw: string): string | undefined {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw);
  if (!dmy) return undefined;
  const [, d, m, y] = dmy;
  if (!d || !m || !y) return undefined;
  const day = Number(d);
  const month = Number(m);
  if (day < 1 || day > 31 || month < 1 || month > 12) return undefined;
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function convertAttributeValue(def: AttributeDefRow, raw: string): ConvertResult {
  const value = raw.trim();
  if (value === '') return { ok: true, value: undefined };

  switch (def.type) {
    case 'text':
      return { ok: true, value };
    case 'number': {
      // LatAm CSVs often use a decimal comma.
      const n = Number(value.replace(',', '.'));
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, reason: 'invalid_number' };
    }
    case 'date': {
      const iso = toIsoDate(value);
      return iso ? { ok: true, value: iso } : { ok: false, reason: 'invalid_date' };
    }
    case 'boolean': {
      const lower = value.toLowerCase();
      if (TRUE_WORDS.has(lower)) return { ok: true, value: true };
      if (FALSE_WORDS.has(lower)) return { ok: true, value: false };
      return { ok: false, reason: 'invalid_boolean' };
    }
    case 'select': {
      const options = selectOptions(def);
      const match = options.find((option) => option.toLowerCase() === value.toLowerCase());
      return match ? { ok: true, value: match } : { ok: false, reason: 'invalid_option' };
    }
  }
}
