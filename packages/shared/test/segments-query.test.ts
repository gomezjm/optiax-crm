import { describe, expect, it } from 'vitest';
import type { AttributeType } from '../src/schemas/masters.js';
import { SegmentRulesSchema, type SegmentRules } from '../src/schemas/segment-rules.js';
import {
  buildSegmentPostgrestPlan,
  referencedTagNames,
  segmentRulesToQuery,
  SegmentQueryError,
  validateSegmentRules,
  type SegmentEvalContext,
  type SegmentPredicate,
} from '../src/segments/query.js';

const NOW = new Date('2026-07-21T12:00:00Z'); // 07:00 in Bogotá

const ATTRS: Record<string, AttributeType> = {
  cumpleanos: 'date',
  metodo_pago_preferido: 'select',
  barrio_entrega: 'text',
  acepta_mayorista: 'boolean',
  descuento_pct: 'number',
  talla_preferida: 'select',
};

const ctx: SegmentEvalContext = { now: NOW, timeZone: 'America/Bogota', attributeTypes: ATTRS };

/** Translate a single-condition `and` rule and return its one predicate. */
function one(field: string, op: string, value?: string | number): SegmentPredicate {
  const rules = SegmentRulesSchema.parse({
    combinator: 'and',
    conditions: [value === undefined ? { field, op } : { field, op, value }],
  });
  return segmentRulesToQuery(rules, ctx).predicates[0]!;
}

describe('segmentRulesToQuery — scalar columns', () => {
  it('total_spent numeric comparisons map to direct column predicates', () => {
    expect(one('total_spent', 'gte', 100000)).toEqual({
      kind: 'column',
      column: 'total_spent',
      op: 'gte',
      value: 100000,
      negate: false,
    });
    expect(one('total_spent', 'lt', 50000)).toMatchObject({ column: 'total_spent', op: 'lt', value: 50000 });
  });

  it('coerces a numeric string value to a number', () => {
    expect(one('total_spent', 'eq', '200000')).toMatchObject({ value: 200000 });
  });

  it('throws when a numeric field gets a non-numeric value', () => {
    expect(() => one('total_spent', 'gte', 'mucho')).toThrow(SegmentQueryError);
  });

  it('text fields eq/neq compare the column directly', () => {
    expect(one('city', 'eq', 'Medellín')).toEqual({
      kind: 'column',
      column: 'city',
      op: 'eq',
      value: 'Medellín',
      negate: false,
    });
    expect(one('age_group', 'neq', '25-34')).toMatchObject({ op: 'neq', value: '25-34' });
  });

  it('text contains becomes a sanitized ilike pattern', () => {
    expect(one('city', 'contains', 'medel')).toMatchObject({ op: 'ilike', value: '%medel%' });
    // wildcards / underscores are stripped from the term
    expect(one('city', 'contains', 'a%b_c')).toMatchObject({ value: '%a b c%' });
  });
});

describe('segmentRulesToQuery — date fields', () => {
  it('older_than_days on a timestamptz column → lt the local-day cutoff instant', () => {
    expect(one('last_order_at', 'older_than_days', 30)).toEqual({
      kind: 'column',
      column: 'last_order_at',
      op: 'lt',
      value: '2026-06-21T05:00:00.000Z',
      negate: false,
    });
  });

  it('newer_than_days on a timestamptz column → gte the cutoff instant', () => {
    expect(one('last_message_at', 'newer_than_days', 15)).toMatchObject({
      column: 'last_message_at',
      op: 'gte',
      value: '2026-07-06T05:00:00.000Z',
    });
  });

  it('absolute date comparisons pass the ISO value through', () => {
    expect(one('last_order_at', 'gte', '2026-01-01')).toMatchObject({ op: 'gte', value: '2026-01-01' });
  });
});

describe('segmentRulesToQuery — tag membership', () => {
  it('eq / contains → positive membership', () => {
    expect(one('tag', 'contains', 'VIP')).toEqual({ kind: 'tag', tagName: 'VIP', negate: false });
    expect(one('tag', 'eq', 'VIP')).toEqual({ kind: 'tag', tagName: 'VIP', negate: false });
  });

  it('neq → non-membership', () => {
    expect(one('tag', 'neq', 'VIP')).toEqual({ kind: 'tag', tagName: 'VIP', negate: true });
  });
});

describe('segmentRulesToQuery — jsonb attributes (type-aware)', () => {
  it('number attribute uses the -> arrow (numeric ordering)', () => {
    expect(one('attribute.descuento_pct', 'gte', 10)).toEqual({
      kind: 'column',
      column: 'attributes->descuento_pct',
      op: 'gte',
      value: 10,
      negate: false,
    });
  });

  it('select/text attribute uses the ->> arrow (text)', () => {
    expect(one('attribute.talla_preferida', 'eq', 'M')).toMatchObject({
      column: 'attributes->>talla_preferida',
      op: 'eq',
      value: 'M',
    });
    expect(one('attribute.barrio_entrega', 'contains', 'poblado')).toMatchObject({
      column: 'attributes->>barrio_entrega',
      op: 'ilike',
      value: '%poblado%',
    });
  });

  it('boolean attribute uses the -> arrow and coerces the value', () => {
    expect(one('attribute.acepta_mayorista', 'eq', 'true')).toEqual({
      kind: 'column',
      column: 'attributes->acepta_mayorista',
      op: 'eq',
      value: true,
      negate: false,
    });
    expect(one('attribute.acepta_mayorista', 'neq', 'false')).toMatchObject({ value: false, op: 'neq' });
  });

  it('date attribute older_than_days compares ->> text against the date-only cutoff', () => {
    expect(one('attribute.cumpleanos', 'older_than_days', 30)).toEqual({
      kind: 'column',
      column: 'attributes->>cumpleanos',
      op: 'lt',
      value: '2026-06-21',
      negate: false,
    });
  });

  it('unknown attribute key → always-false (never throws)', () => {
    expect(one('attribute.nonexistent', 'eq', 'x')).toEqual({ kind: 'always-false' });
  });
});

describe('segmentRulesToQuery — presence ops', () => {
  it('is_empty on a column → is null', () => {
    expect(one('last_order_at', 'is_empty')).toEqual({
      kind: 'column',
      column: 'last_order_at',
      op: 'is',
      value: null,
      negate: false,
    });
  });

  it('is_set on a column → NOT is null', () => {
    expect(one('last_message_at', 'is_set')).toMatchObject({ op: 'is', value: null, negate: true });
  });

  it('presence on a jsonb attribute uses the ->> text form (key absence = empty)', () => {
    expect(one('attribute.descuento_pct', 'is_empty')).toMatchObject({
      column: 'attributes->>descuento_pct',
      op: 'is',
      negate: false,
    });
    expect(one('attribute.acepta_mayorista', 'is_set')).toMatchObject({
      column: 'attributes->>acepta_mayorista',
      negate: true,
    });
  });
});

describe('segmentRulesToQuery — invalid field/op pairs throw', () => {
  const badPairs: Array<[string, string, string | number | undefined]> = [
    ['total_spent', 'contains', 5],
    ['total_spent', 'older_than_days', 5],
    ['city', 'gt', 'x'],
    ['tag', 'older_than_days', 5],
    ['tag', 'is_set', undefined],
    ['last_order_at', 'contains', 'x'],
    ['attribute.acepta_mayorista', 'contains', 'x'],
  ];
  for (const [field, op, value] of badPairs) {
    it(`${field} ${op} throws`, () => {
      expect(() => one(field, op, value)).toThrow(SegmentQueryError);
    });
  }
});

describe('segmentRulesToQuery — combinator + edges', () => {
  it('preserves the combinator', () => {
    const rules = SegmentRulesSchema.parse({
      combinator: 'or',
      conditions: [
        { field: 'city', op: 'eq', value: 'Medellín' },
        { field: 'total_spent', op: 'gte', value: 400000 },
      ],
    });
    const q = segmentRulesToQuery(rules, ctx);
    expect(q.combinator).toBe('or');
    expect(q.predicates).toHaveLength(2);
  });

  it('empty conditions → matches everything (no predicates)', () => {
    // The schema forbids this, so build the object directly.
    const q = segmentRulesToQuery({ combinator: 'and', conditions: [] } as SegmentRules, ctx);
    expect(q.predicates).toEqual([]);
  });

  it('is pure/deterministic for a fixed now', () => {
    const rules = SegmentRulesSchema.parse({
      combinator: 'and',
      conditions: [{ field: 'last_order_at', op: 'older_than_days', value: 30 }],
    });
    expect(segmentRulesToQuery(rules, ctx)).toEqual(segmentRulesToQuery(rules, ctx));
  });

  it('never emits a tenant_id (tenant-agnostic)', () => {
    const rules = SegmentRulesSchema.parse({
      combinator: 'and',
      conditions: [
        { field: 'total_spent', op: 'gte', value: 1 },
        { field: 'tag', op: 'contains', value: 'VIP' },
      ],
    });
    const json = JSON.stringify(segmentRulesToQuery(rules, ctx));
    expect(json).not.toMatch(/tenant/i);
  });
});

// ── PostgREST plan ──────────────────────────────────────────────────────────

const TAGS = { tagMembers: { VIP: ['id-1', 'id-2'], Empty: [] } };

function planFor(rules: SegmentRules) {
  return buildSegmentPostgrestPlan(segmentRulesToQuery(rules, ctx), TAGS);
}

describe('buildSegmentPostgrestPlan — and', () => {
  it('emits one filter per predicate', () => {
    const plan = planFor(
      SegmentRulesSchema.parse({
        combinator: 'and',
        conditions: [
          { field: 'total_spent', op: 'gte', value: 200000 },
          { field: 'city', op: 'eq', value: 'Medellín' },
        ],
      }),
    );
    expect(plan).toEqual({
      combinator: 'and',
      filters: [
        { method: 'op', column: 'total_spent', op: 'gte', value: 200000 },
        { method: 'op', column: 'city', op: 'eq', value: 'Medellín' },
      ],
    });
  });

  it('resolves a positive tag to id in (members)', () => {
    const plan = planFor(
      SegmentRulesSchema.parse({ combinator: 'and', conditions: [{ field: 'tag', op: 'contains', value: 'VIP' }] }),
    );
    expect(plan).toEqual({
      combinator: 'and',
      filters: [{ method: 'in', column: 'id', values: ['id-1', 'id-2'], negate: false }],
    });
  });

  it('resolves a negated tag to NOT in (members)', () => {
    const plan = planFor(
      SegmentRulesSchema.parse({ combinator: 'and', conditions: [{ field: 'tag', op: 'neq', value: 'VIP' }] }),
    );
    expect(plan).toMatchObject({ filters: [{ method: 'in', values: ['id-1', 'id-2'], negate: true }] });
  });

  it('an empty/unknown tag becomes id in () — matches nobody', () => {
    const plan = planFor(
      SegmentRulesSchema.parse({ combinator: 'and', conditions: [{ field: 'tag', op: 'contains', value: 'Empty' }] }),
    );
    expect(plan).toMatchObject({ filters: [{ method: 'in', column: 'id', values: [], negate: false }] });
  });

  it('an unknown attribute key becomes id in () — matches nobody', () => {
    const plan = planFor(
      SegmentRulesSchema.parse({ combinator: 'and', conditions: [{ field: 'attribute.nope', op: 'eq', value: 'x' }] }),
    );
    expect(plan).toMatchObject({ filters: [{ method: 'in', column: 'id', values: [] }] });
  });

  it('presence op → is-null filter', () => {
    const plan = planFor(
      SegmentRulesSchema.parse({ combinator: 'and', conditions: [{ field: 'last_order_at', op: 'is_empty' }] }),
    );
    expect(plan).toMatchObject({ filters: [{ method: 'is-null', column: 'last_order_at', negate: false }] });
  });
});

describe('buildSegmentPostgrestPlan — or (single expression)', () => {
  it('joins scalar terms, quoting string values', () => {
    const plan = planFor(
      SegmentRulesSchema.parse({
        combinator: 'or',
        conditions: [
          { field: 'city', op: 'eq', value: 'Medellín' },
          { field: 'total_spent', op: 'gte', value: 400000 },
        ],
      }),
    );
    expect(plan).toEqual({ combinator: 'or', expression: 'city.eq."Medellín",total_spent.gte.400000' });
  });

  it('serializes tag membership, presence, ilike and negation as or terms', () => {
    const plan = planFor(
      SegmentRulesSchema.parse({
        combinator: 'or',
        conditions: [
          { field: 'tag', op: 'contains', value: 'VIP' },
          { field: 'tag', op: 'neq', value: 'Empty' },
          { field: 'last_order_at', op: 'is_set' },
          { field: 'city', op: 'contains', value: 'bogo' },
        ],
      }),
    );
    expect(plan).toEqual({
      combinator: 'or',
      expression: 'id.in.(id-1,id-2),id.not.in.(),last_order_at.not.is.null,city.ilike.%bogo%',
    });
  });

  it('escapes embedded quotes/backslashes in or values', () => {
    const plan = planFor(
      SegmentRulesSchema.parse({ combinator: 'or', conditions: [{ field: 'city', op: 'eq', value: 'a"b\\c' }] }),
    );
    expect(plan).toEqual({ combinator: 'or', expression: 'city.eq."a\\"b\\\\c"' });
  });
});

// ── validate + helpers ──────────────────────────────────────────────────────

describe('validateSegmentRules', () => {
  it('returns no errors for a valid rule', () => {
    const rules = SegmentRulesSchema.parse({
      combinator: 'and',
      conditions: [{ field: 'total_spent', op: 'gte', value: 1 }],
    });
    expect(validateSegmentRules(rules, ctx)).toEqual([]);
  });

  it('flags an operator invalid for the field type', () => {
    const rules = SegmentRulesSchema.parse({
      combinator: 'and',
      conditions: [
        { field: 'total_spent', op: 'gte', value: 1 },
        { field: 'city', op: 'gt', value: 'x' },
      ],
    });
    const errors = validateSegmentRules(rules, ctx);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.conditionIndex).toBe(1);
  });

  it('does not flag an unknown attribute key (valid, matches nothing)', () => {
    const rules = SegmentRulesSchema.parse({
      combinator: 'and',
      conditions: [{ field: 'attribute.unknown', op: 'eq', value: 'x' }],
    });
    expect(validateSegmentRules(rules, ctx)).toEqual([]);
  });
});

describe('referencedTagNames', () => {
  it('lists distinct tag names referenced by the query', () => {
    const rules = SegmentRulesSchema.parse({
      combinator: 'or',
      conditions: [
        { field: 'tag', op: 'contains', value: 'VIP' },
        { field: 'tag', op: 'neq', value: 'VIP' },
        { field: 'tag', op: 'contains', value: 'Mayorista' },
        { field: 'city', op: 'eq', value: 'x' },
      ],
    });
    expect(referencedTagNames(segmentRulesToQuery(rules, ctx)).sort()).toEqual(['Mayorista', 'VIP']);
  });
});
