import { describe, expect, it } from 'vitest';
import {
  hasActiveFilters,
  parseFilterModel,
  serializeFilterModel,
  type CustomerFilterModel,
} from '../../src/lib/customers/filter-model';
import type { AttributeDefRow } from '../../src/lib/customers/types';

function def(partial: Partial<AttributeDefRow> & Pick<AttributeDefRow, 'key' | 'type'>): AttributeDefRow {
  return {
    id: `def-${partial.key}`,
    created_at: '2026-07-18T00:00:00Z',
    tenant_id: 't',
    label: partial.key,
    options: null,
    enabled: true,
    is_preset: false,
    ...partial,
  };
}

const DEFS: AttributeDefRow[] = [
  def({ key: 'talla_preferida', type: 'select', options: ['S', 'M', 'L'] }),
  def({ key: 'vip', type: 'boolean' }),
  def({ key: 'barrio_entrega', type: 'text' }),
  def({ key: 'puntos', type: 'number' }),
  def({ key: 'cumpleanos', type: 'date' }),
];

describe('parseFilterModel', () => {
  it('parses every param type', () => {
    const params = new URLSearchParams({
      q: 'camila',
      tags: 'id1,id2',
      consent: 'opted_in',
      source: 'manual',
      'attr.talla_preferida': 'M',
      'attr.vip': 'true',
      'attr.barrio_entrega': 'poblado',
      'attr.puntos.min': '10',
      'attr.puntos.max': '50',
      'attr.cumpleanos.min': '1990-01-01',
      spentMin: '10000',
      spentMax: '500000',
      orderOlder: '30',
      orderNewer: '7',
      sort: 'total_spent',
      dir: 'desc',
      page: '3',
    });
    const model = parseFilterModel(params, DEFS);
    expect(model).toEqual({
      search: 'camila',
      tagIds: ['id1', 'id2'],
      consent: 'opted_in',
      source: 'manual',
      attributes: [
        { key: 'talla_preferida', type: 'select', value: 'M' },
        { key: 'vip', type: 'boolean', value: true },
        { key: 'barrio_entrega', type: 'text', contains: 'poblado' },
        { key: 'puntos', type: 'number', min: 10, max: 50 },
        { key: 'cumpleanos', type: 'date', min: '1990-01-01' },
      ],
      totalSpentMin: 10000,
      totalSpentMax: 500000,
      lastOrderOlderThanDays: 30,
      lastOrderNewerThanDays: 7,
      sort: 'total_spent',
      sortDir: 'desc',
      page: 3,
    });
  });

  it('drops malformed values instead of guessing', () => {
    const params = new URLSearchParams({
      consent: 'nope',
      source: 'martian',
      'attr.vip': 'maybe',
      'attr.puntos.min': 'abc',
      'attr.cumpleanos.min': '01/01/1990',
      spentMin: 'x',
      orderOlder: '-3',
      sort: 'city',
      dir: 'sideways',
      page: '0',
    });
    expect(parseFilterModel(params, DEFS)).toEqual({});
  });

  it('ignores attribute params without a matching def', () => {
    const params = new URLSearchParams({ 'attr.unknown_key': 'x' });
    expect(parseFilterModel(params, DEFS)).toEqual({});
  });
});

describe('serializeFilterModel', () => {
  it('round-trips through parse', () => {
    const model: CustomerFilterModel = {
      search: 'ana',
      tagIds: ['a', 'b'],
      consent: 'opted_out',
      source: 'import',
      attributes: [
        { key: 'talla_preferida', type: 'select', value: 'L' },
        { key: 'vip', type: 'boolean', value: false },
        { key: 'puntos', type: 'number', max: 9 },
        { key: 'cumpleanos', type: 'date', min: '1985-05-05', max: '1999-12-31' },
      ],
      totalSpentMin: 5,
      lastOrderOlderThanDays: 45,
      sort: 'last_order_at',
      sortDir: 'desc',
      page: 2,
    };
    const params = serializeFilterModel(model);
    expect(parseFilterModel(params, DEFS)).toEqual(model);
  });

  it('omits page 1 for clean URLs', () => {
    expect(serializeFilterModel({ page: 1 }).toString()).toBe('');
  });
});

describe('hasActiveFilters', () => {
  it('is false for sort/page only', () => {
    expect(hasActiveFilters({ sort: 'name', sortDir: 'desc', page: 4 })).toBe(false);
  });
  it('is true for any real filter', () => {
    expect(hasActiveFilters({ consent: 'unknown' })).toBe(true);
    expect(hasActiveFilters({ totalSpentMax: 10 })).toBe(true);
  });
});
