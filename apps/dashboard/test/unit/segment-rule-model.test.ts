/**
 * Unit tests for the rule-builder model (ws-c1 §2/§5): the operator menu and
 * value widget are driven by the chosen field's type, and the builder only ever
 * produces `SegmentRules` that round-trip through the schema.
 */
import { describe, expect, it } from 'vitest';
import { SegmentRulesSchema, type SegmentField } from '@optiax/shared';
import type { AttributeDefRow } from '@/lib/customers/types';
import {
  defaultOperatorFor,
  defaultValueFor,
  fieldOptions,
  operatorsForField,
  valueInputFor,
} from '@/lib/segments/rule-model';

function def(key: string, type: AttributeDefRow['type'], options: string[] | null = null): AttributeDefRow {
  return {
    id: key,
    tenant_id: 't',
    created_at: '2026-01-01T00:00:00Z',
    key,
    label: key,
    type,
    options,
    enabled: true,
    is_preset: false,
  };
}

const DEFS: AttributeDefRow[] = [
  def('talla_preferida', 'select', ['XS', 'S', 'M', 'L']),
  def('descuento_pct', 'number'),
  def('acepta_mayorista', 'boolean'),
  def('cumpleanos', 'date'),
  def('barrio_entrega', 'text'),
];

describe('fieldOptions', () => {
  it('lists the fixed fields plus every enabled attribute def', () => {
    const opts = fieldOptions(DEFS);
    const values = opts.map((o) => o.value);
    expect(values).toContain('total_spent');
    expect(values).toContain('tag');
    expect(values).toContain('attribute.talla_preferida' as SegmentField);
    expect(values).toContain('attribute.descuento_pct' as SegmentField);
  });
});

describe('operatorsForField (type-driven)', () => {
  it('numbers get comparison ops, not contains', () => {
    const ops = operatorsForField('total_spent', DEFS);
    expect(ops).toContain('gte');
    expect(ops).not.toContain('contains');
  });

  it('text gets contains, not gt', () => {
    const ops = operatorsForField('city', DEFS);
    expect(ops).toContain('contains');
    expect(ops).not.toContain('gt');
  });

  it('date gets the relative window ops', () => {
    const ops = operatorsForField('last_order_at', DEFS);
    expect(ops).toContain('older_than_days');
    expect(ops).toContain('newer_than_days');
  });

  it('tag gets membership ops only (no presence)', () => {
    const ops = operatorsForField('tag', DEFS);
    expect(ops).toEqual(['eq', 'contains', 'neq']);
  });
});

describe('valueInputFor (type-driven widget)', () => {
  it('number field → number input', () => {
    expect(valueInputFor('total_spent', 'gte', DEFS)).toEqual({ kind: 'number' });
  });

  it('date field switches widget by operator', () => {
    expect(valueInputFor('last_order_at', 'older_than_days', DEFS)).toEqual({ kind: 'days' });
    expect(valueInputFor('last_order_at', 'gte', DEFS)).toEqual({ kind: 'date' });
  });

  it('tag → tag picker', () => {
    expect(valueInputFor('tag', 'contains', DEFS)).toEqual({ kind: 'tag' });
  });

  it('select attribute → select with its options', () => {
    expect(valueInputFor('attribute.talla_preferida' as SegmentField, 'eq', DEFS)).toEqual({
      kind: 'select',
      options: ['XS', 'S', 'M', 'L'],
    });
  });

  it('boolean attribute → boolean toggle', () => {
    expect(valueInputFor('attribute.acepta_mayorista' as SegmentField, 'eq', DEFS)).toEqual({
      kind: 'boolean',
    });
  });

  it('presence op → no value widget', () => {
    expect(valueInputFor('last_message_at', 'is_set', DEFS)).toEqual({ kind: 'none' });
  });
});

describe('builder defaults round-trip through the schema', () => {
  it('a default condition for every field is a valid rule', () => {
    for (const opt of fieldOptions(DEFS)) {
      const op = defaultOperatorFor(opt.value, DEFS);
      const value = defaultValueFor(opt.value, op, DEFS);
      const condition = value === undefined ? { field: opt.value, op } : { field: opt.value, op, value };
      const result = SegmentRulesSchema.safeParse({ combinator: 'and', conditions: [condition] });
      expect(result.success, `${opt.value} ${op}`).toBe(true);
    }
  });
});
