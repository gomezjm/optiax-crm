/**
 * Field-type taxonomy for the segment DSL: what kind of value each field holds
 * and which operators are valid on it. Shared by the engine (to translate a
 * condition), the dashboard rule builder (to drive the operator menu + value
 * input off the chosen field), and `validateSegmentRules` (to reject nonsensical
 * field/op pairs the Zod schema can't see, since it doesn't couple op to field).
 */
import type { AttributeType } from '../schemas/masters.js';
import { SEGMENT_FIELDS, type SegmentField, type SegmentOp } from '../schemas/segment-rules.js';

/**
 * The comparison shape a field reduces to. Attribute `select` collapses to
 * `text` (both compare as jsonb `->>` text); everything else maps 1:1.
 */
export type SegmentFieldType = 'number' | 'text' | 'date' | 'boolean' | 'tag';

const FIXED_FIELD_TYPES: Record<(typeof SEGMENT_FIELDS)[number], SegmentFieldType> = {
  total_spent: 'number',
  last_order_at: 'date',
  last_message_at: 'date',
  age_group: 'text',
  city: 'text',
  tag: 'tag',
};

const ATTRIBUTE_PREFIX = 'attribute.';

/** True for a dynamic `attribute.<key>` field. */
export function isAttributeField(field: SegmentField): boolean {
  return field.startsWith(ATTRIBUTE_PREFIX);
}

/** The attribute key of an `attribute.<key>` field, or null for a fixed field. */
export function attributeKey(field: SegmentField): string | null {
  return isAttributeField(field) ? field.slice(ATTRIBUTE_PREFIX.length) : null;
}

/** How an attribute def's type maps onto a comparison shape. */
export function attributeTypeToFieldType(type: AttributeType): SegmentFieldType {
  switch (type) {
    case 'number':
      return 'number';
    case 'date':
      return 'date';
    case 'boolean':
      return 'boolean';
    case 'text':
    case 'select':
      return 'text';
  }
}

/**
 * The field's comparison type. Fixed fields resolve statically; an
 * `attribute.<key>` field resolves through the tenant's attribute defs. An
 * unknown attribute key returns `null` — the engine turns that into "no match"
 * (never an error), per the spec.
 */
export function fieldType(
  field: SegmentField,
  attributeTypes: Record<string, AttributeType>,
): SegmentFieldType | null {
  const key = attributeKey(field);
  if (key !== null) {
    const type = attributeTypes[key];
    return type ? attributeTypeToFieldType(type) : null;
  }
  return FIXED_FIELD_TYPES[field as (typeof SEGMENT_FIELDS)[number]];
}

const PRESENCE_OPS: SegmentOp[] = ['is_set', 'is_empty'];

const OPS_BY_TYPE: Record<SegmentFieldType, SegmentOp[]> = {
  number: ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', ...PRESENCE_OPS],
  text: ['eq', 'neq', 'contains', ...PRESENCE_OPS],
  // Date columns support both the relative window ops and absolute compares
  // (value = ISO date/timestamp string), plus presence.
  date: ['older_than_days', 'newer_than_days', 'gt', 'lt', 'gte', 'lte', ...PRESENCE_OPS],
  boolean: ['eq', 'neq', ...PRESENCE_OPS],
  // Tag is set-membership, not a column: `eq`/`contains` mean "has this tag",
  // `neq` means "does not have it". Presence is meaningless for a tag.
  tag: ['eq', 'contains', 'neq'],
};

/** Operators valid for a comparison type — drives the rule builder's op menu. */
export function opsForFieldType(type: SegmentFieldType): SegmentOp[] {
  return OPS_BY_TYPE[type];
}

/** Whether `op` is meaningful for `type`. */
export function isOpValidForFieldType(type: SegmentFieldType, op: SegmentOp): boolean {
  return OPS_BY_TYPE[type].includes(op);
}
