import { z } from 'zod';

/**
 * Segment rule DSL (phase-0 §4). A segment is a combinator (`and`/`or`) over a
 * list of {field, operator, value} conditions, evaluated live against the
 * tenant's customers by the shared engine in `../segments/`.
 *
 * ## Rules version
 *
 * Ws-c1 added the two presence operators `is_set` / `is_empty` so the PRD
 * "window shoppers" template ("has messages but no orders") is expressible
 * faithfully rather than approximated. The change is strictly additive — every
 * rule authored under v1 stays valid — so it bumps `SEGMENT_RULES_VERSION` to 2
 * as a documentation marker only (nothing branches on it yet; C2 can read it if
 * it ever needs to gate on operator availability). See ws-c1 §3 + SESSION_NOTES.
 */
export const SEGMENT_RULES_VERSION = 2;

export const SEGMENT_FIELDS = [
  'last_order_at',
  'total_spent',
  'last_message_at',
  'age_group',
  'city',
  'tag',
] as const;

/** Fixed fields, plus dynamic per-tenant attributes as `attribute.<key>`. */
export const SegmentFieldSchema = z.union([
  z.enum(SEGMENT_FIELDS),
  z
    .string()
    .regex(/^attribute\.[a-z0-9_]{1,60}$/, "must be 'attribute.<key>' (snake_case key)"),
]);

/** All segment operators. `is_set`/`is_empty` are the ws-c1 additive extension. */
export const SEGMENT_OPS = [
  'eq',
  'neq',
  'gt',
  'lt',
  'gte',
  'lte',
  'contains',
  'older_than_days',
  'newer_than_days',
  'is_set',
  'is_empty',
] as const;

export const SegmentOpSchema = z.enum(SEGMENT_OPS);

/** Operators that check presence only — they carry no comparison value. */
export const SEGMENT_PRESENCE_OPS = ['is_set', 'is_empty'] as const;

function isPresenceOp(op: string): boolean {
  return (SEGMENT_PRESENCE_OPS as readonly string[]).includes(op);
}

export const SegmentConditionSchema = z
  .object({
    field: SegmentFieldSchema,
    op: SegmentOpSchema,
    // Optional so presence ops (`is_set`/`is_empty`) can omit it; every other
    // op requires it (enforced below). v1 rules always carried a value, so
    // making it optional is backward compatible.
    value: z.union([z.string().max(300), z.number()]).optional(),
  })
  .strict()
  .superRefine((cond, ctx) => {
    if (!isPresenceOp(cond.op) && cond.value === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: 'value is required for this operator',
      });
    }
  });

export const SegmentRulesSchema = z
  .object({
    combinator: z.enum(['and', 'or']),
    conditions: z.array(SegmentConditionSchema).min(1).max(20),
  })
  .strict();

export type SegmentField = z.infer<typeof SegmentFieldSchema>;
export type SegmentOp = z.infer<typeof SegmentOpSchema>;
export type SegmentCondition = z.infer<typeof SegmentConditionSchema>;
export type SegmentRules = z.infer<typeof SegmentRulesSchema>;
