import { describe, expect, it } from 'vitest';
import {
  autoMatchHeader,
  autoMatchHeaders,
  normalizeHeader,
} from '../../src/lib/customers/header-matching';
import type { AttributeDefRow } from '../../src/lib/customers/types';

function def(key: string, label: string): AttributeDefRow {
  return {
    id: `def-${key}`,
    created_at: '2026-07-18T00:00:00Z',
    tenant_id: 't',
    key,
    label,
    type: 'text',
    options: null,
    enabled: true,
    is_preset: false,
  };
}

const DEFS = [def('barrio_entrega', 'Barrio de entrega'), def('talla_preferida', 'Talla preferida')];

describe('normalizeHeader', () => {
  it('lowercases, strips accents and collapses separators', () => {
    expect(normalizeHeader('Teléfono')).toBe('telefono');
    expect(normalizeHeader('  Correo_Electrónico ')).toBe('correo electronico');
    expect(normalizeHeader('age-group')).toBe('age group');
  });
});

describe('autoMatchHeader', () => {
  it('matches Spanish and English core aliases', () => {
    expect(autoMatchHeader('Nombre', DEFS)).toEqual({ kind: 'core', field: 'name' });
    expect(autoMatchHeader('name', DEFS)).toEqual({ kind: 'core', field: 'name' });
    expect(autoMatchHeader('Teléfono', DEFS)).toEqual({ kind: 'core', field: 'phone' });
    expect(autoMatchHeader('WhatsApp', DEFS)).toEqual({ kind: 'core', field: 'phone' });
    expect(autoMatchHeader('Correo electrónico', DEFS)).toEqual({ kind: 'core', field: 'email' });
    expect(autoMatchHeader('Ciudad', DEFS)).toEqual({ kind: 'core', field: 'city' });
    expect(autoMatchHeader('Dirección', DEFS)).toEqual({ kind: 'core', field: 'address' });
    expect(autoMatchHeader('Género', DEFS)).toEqual({ kind: 'core', field: 'gender' });
    expect(autoMatchHeader('Rango de edad', DEFS)).toEqual({ kind: 'core', field: 'age_group' });
    expect(autoMatchHeader('Consentimiento', DEFS)).toEqual({
      kind: 'core',
      field: 'consent_status',
    });
  });

  it('matches attribute defs by key or label', () => {
    expect(autoMatchHeader('barrio_entrega', DEFS)).toEqual({
      kind: 'attribute',
      key: 'barrio_entrega',
    });
    expect(autoMatchHeader('Barrio de Entrega', DEFS)).toEqual({
      kind: 'attribute',
      key: 'barrio_entrega',
    });
    expect(autoMatchHeader('Talla preferida', DEFS)).toEqual({
      kind: 'attribute',
      key: 'talla_preferida',
    });
  });

  it('falls back to ignore for unknown headers', () => {
    expect(autoMatchHeader('Notas internas', DEFS)).toEqual({ kind: 'ignore' });
    expect(autoMatchHeader('', DEFS)).toEqual({ kind: 'ignore' });
  });
});

describe('autoMatchHeaders', () => {
  it('gives a duplicate target only to the first header', () => {
    const targets = autoMatchHeaders(['Nombre', 'Name', 'Teléfono'], DEFS);
    expect(targets).toEqual([
      { kind: 'core', field: 'name' },
      { kind: 'ignore' },
      { kind: 'core', field: 'phone' },
    ]);
  });
});
