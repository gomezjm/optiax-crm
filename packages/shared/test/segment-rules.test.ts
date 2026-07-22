import { describe, expect, it } from 'vitest';
import { SegmentRulesSchema } from '../src/schemas/segment-rules.js';

describe('SegmentRulesSchema', () => {
  it('accepts fixed fields and operators', () => {
    const rules = SegmentRulesSchema.parse({
      combinator: 'and',
      conditions: [
        { field: 'last_order_at', op: 'older_than_days', value: 30 },
        { field: 'total_spent', op: 'gte', value: 100000 },
        { field: 'city', op: 'eq', value: 'Medellín' },
        { field: 'tag', op: 'contains', value: 'VIP' },
      ],
    });
    expect(rules.conditions).toHaveLength(4);
  });

  it("accepts dynamic 'attribute.<key>' fields", () => {
    const result = SegmentRulesSchema.safeParse({
      combinator: 'or',
      conditions: [{ field: 'attribute.talla_preferida', op: 'eq', value: 'M' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown fields, malformed attribute keys, and unknown ops', () => {
    expect(
      SegmentRulesSchema.safeParse({
        combinator: 'and',
        conditions: [{ field: 'favorite_color', op: 'eq', value: 'x' }],
      }).success,
    ).toBe(false);
    expect(
      SegmentRulesSchema.safeParse({
        combinator: 'and',
        conditions: [{ field: 'attribute.Talla Preferida', op: 'eq', value: 'x' }],
      }).success,
    ).toBe(false);
    expect(
      SegmentRulesSchema.safeParse({
        combinator: 'and',
        conditions: [{ field: 'city', op: 'like', value: 'x' }],
      }).success,
    ).toBe(false);
  });

  it('requires at least one condition', () => {
    expect(SegmentRulesSchema.safeParse({ combinator: 'and', conditions: [] }).success).toBe(false);
  });

  it('accepts presence ops without a value (ws-c1 additive extension)', () => {
    const result = SegmentRulesSchema.safeParse({
      combinator: 'and',
      conditions: [
        { field: 'last_message_at', op: 'is_set' },
        { field: 'last_order_at', op: 'is_empty' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('still requires a value for non-presence ops', () => {
    expect(
      SegmentRulesSchema.safeParse({
        combinator: 'and',
        conditions: [{ field: 'total_spent', op: 'gte' }],
      }).success,
    ).toBe(false);
  });
});
