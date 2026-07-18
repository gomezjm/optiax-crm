import { z } from 'zod';

/** Segment rule DSL (spec §4). Evaluated server-side in a later phase. */

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

export const SegmentOpSchema = z.enum([
  'eq',
  'neq',
  'gt',
  'lt',
  'gte',
  'lte',
  'contains',
  'older_than_days',
  'newer_than_days',
]);

export const SegmentConditionSchema = z
  .object({
    field: SegmentFieldSchema,
    op: SegmentOpSchema,
    value: z.union([z.string().max(300), z.number()]),
  })
  .strict();

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
