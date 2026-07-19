/**
 * CSV header auto-matching (WS-D1 §6): map common Spanish/English headers to
 * core customer fields, and extra columns to enabled attribute defs by key or
 * label. Pure + unit-tested.
 */
import type { AttributeDefRow } from './types';

export const CORE_IMPORT_FIELDS = [
  'name',
  'phone',
  'email',
  'address',
  'city',
  'gender',
  'age_group',
  'consent_status',
] as const;
export type CoreImportField = (typeof CORE_IMPORT_FIELDS)[number];

export type HeaderTarget =
  | { kind: 'core'; field: CoreImportField }
  | { kind: 'attribute'; key: string }
  | { kind: 'ignore' };

/** lowercase, accent-stripped, separators collapsed to single spaces. */
export function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_\-./]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CORE_ALIASES: Record<string, CoreImportField> = {
  nombre: 'name',
  'nombre completo': 'name',
  name: 'name',
  'full name': 'name',
  cliente: 'name',
  telefono: 'phone',
  tel: 'phone',
  celular: 'phone',
  movil: 'phone',
  whatsapp: 'phone',
  phone: 'phone',
  'phone number': 'phone',
  numero: 'phone',
  correo: 'email',
  'correo electronico': 'email',
  email: 'email',
  'e mail': 'email',
  mail: 'email',
  direccion: 'address',
  address: 'address',
  ciudad: 'city',
  city: 'city',
  genero: 'gender',
  sexo: 'gender',
  gender: 'gender',
  edad: 'age_group',
  'grupo de edad': 'age_group',
  'rango de edad': 'age_group',
  'age group': 'age_group',
  age: 'age_group',
  consentimiento: 'consent_status',
  consent: 'consent_status',
  'opt in': 'consent_status',
  optin: 'consent_status',
};

/**
 * Best-guess target for one header. Attribute defs win over nothing but lose
 * to core aliases (a def labeled "Ciudad" should not shadow the core field).
 */
export function autoMatchHeader(header: string, defs: AttributeDefRow[]): HeaderTarget {
  const normalized = normalizeHeader(header);
  if (normalized === '') return { kind: 'ignore' };

  const core = CORE_ALIASES[normalized];
  if (core) return { kind: 'core', field: core };

  for (const def of defs) {
    if (normalizeHeader(def.key) === normalized || normalizeHeader(def.label) === normalized) {
      return { kind: 'attribute', key: def.key };
    }
  }
  return { kind: 'ignore' };
}

/**
 * Match every header; when two headers map to the same target, the first one
 * keeps it and later ones fall back to "ignorar".
 */
export function autoMatchHeaders(headers: string[], defs: AttributeDefRow[]): HeaderTarget[] {
  const taken = new Set<string>();
  return headers.map((header) => {
    const target = autoMatchHeader(header, defs);
    if (target.kind === 'ignore') return target;
    const id = target.kind === 'core' ? `core:${target.field}` : `attr:${target.key}`;
    if (taken.has(id)) return { kind: 'ignore' };
    taken.add(id);
    return target;
  });
}
