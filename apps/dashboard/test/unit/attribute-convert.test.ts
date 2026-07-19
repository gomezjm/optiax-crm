import { describe, expect, it } from 'vitest';
import { convertAttributeValue } from '../../src/lib/customers/attribute-convert';
import type { AttributeDefRow } from '../../src/lib/customers/types';

function def(type: AttributeDefRow['type'], options: string[] | null = null): AttributeDefRow {
  return {
    id: 'def',
    created_at: '2026-07-18T00:00:00Z',
    tenant_id: 't',
    key: 'k',
    label: 'K',
    type,
    options,
    enabled: true,
    is_preset: false,
  };
}

describe('convertAttributeValue', () => {
  it('blank cells mean "not set" for every type', () => {
    for (const type of ['text', 'number', 'date', 'boolean', 'select'] as const) {
      expect(convertAttributeValue(def(type, ['A']), '  ')).toEqual({ ok: true, value: undefined });
    }
  });

  it('text passes through trimmed', () => {
    expect(convertAttributeValue(def('text'), ' Poblado ')).toEqual({ ok: true, value: 'Poblado' });
  });

  it('numbers accept decimal comma', () => {
    expect(convertAttributeValue(def('number'), '12,5')).toEqual({ ok: true, value: 12.5 });
    expect(convertAttributeValue(def('number'), '42')).toEqual({ ok: true, value: 42 });
    expect(convertAttributeValue(def('number'), 'doce')).toEqual({
      ok: false,
      reason: 'invalid_number',
    });
  });

  it('dates accept ISO and DD/MM/YYYY', () => {
    expect(convertAttributeValue(def('date'), '1995-04-01')).toEqual({
      ok: true,
      value: '1995-04-01',
    });
    expect(convertAttributeValue(def('date'), '15/07/1988')).toEqual({
      ok: true,
      value: '1988-07-15',
    });
    expect(convertAttributeValue(def('date'), '03-1998')).toEqual({
      ok: false,
      reason: 'invalid_date',
    });
  });

  it('booleans accept Spanish words', () => {
    expect(convertAttributeValue(def('boolean'), 'Sí')).toEqual({ ok: true, value: true });
    expect(convertAttributeValue(def('boolean'), 'no')).toEqual({ ok: true, value: false });
    expect(convertAttributeValue(def('boolean'), 'quizás')).toEqual({
      ok: false,
      reason: 'invalid_boolean',
    });
  });

  it('selects match options case-insensitively and return the canonical option', () => {
    const selectDef = def('select', ['XS', 'S', 'M']);
    expect(convertAttributeValue(selectDef, 'm')).toEqual({ ok: true, value: 'M' });
    expect(convertAttributeValue(selectDef, 'GG')).toEqual({
      ok: false,
      reason: 'invalid_option',
    });
  });
});
