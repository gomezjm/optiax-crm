/**
 * UI model for the rule builder (ws-c1 §2): turns the tenant's fields + the
 * shared field-type taxonomy into the option lists and value-input kinds that
 * drive the editor. All the type knowledge lives in `@optiax/shared`
 * (`fieldType`, `opsForFieldType`); this only maps it onto form widgets and
 * Spanish labels, so the builder can only ever produce valid `SegmentRules`.
 */
import {
  attributeKey,
  fieldType,
  isAttributeField,
  opsForFieldType,
  SEGMENT_FIELDS,
  SEGMENT_PRESENCE_OPS,
  type SegmentField,
  type SegmentFieldType,
  type SegmentOp,
} from '@optiax/shared';
import { t } from '@/i18n/index';
import type { AttributeDefRow } from '@/lib/customers/types';
import { selectOptions } from '@/lib/customers/types';
import { attributeTypeMap } from './queries';

export interface FieldOption {
  value: SegmentField;
  label: string;
}

/** Selectable fields: the fixed ones, then each enabled attribute def. */
export function fieldOptions(defs: AttributeDefRow[]): FieldOption[] {
  const fixed: FieldOption[] = SEGMENT_FIELDS.map((f) => ({
    value: f,
    label: t(`segments.fields.${f}`),
  }));
  const attrs: FieldOption[] = defs.map((def) => ({
    value: `attribute.${def.key}` as SegmentField,
    label: def.label,
  }));
  return [...fixed, ...attrs];
}

/** The field's comparison type (null for an unknown attribute key). */
export function resolveFieldType(
  field: SegmentField,
  defs: AttributeDefRow[],
): SegmentFieldType | null {
  return fieldType(field, attributeTypeMap(defs));
}

/** Operators valid for a field — drives the operator menu. */
export function operatorsForField(field: SegmentField, defs: AttributeDefRow[]): SegmentOp[] {
  const type = resolveFieldType(field, defs);
  return type ? opsForFieldType(type) : [];
}

export type ValueInput =
  | { kind: 'none' }
  | { kind: 'number' }
  | { kind: 'text' }
  | { kind: 'date' }
  | { kind: 'days' }
  | { kind: 'boolean' }
  | { kind: 'tag' }
  | { kind: 'select'; options: string[] };

function attributeDef(field: SegmentField, defs: AttributeDefRow[]): AttributeDefRow | undefined {
  const key = attributeKey(field);
  return key === null ? undefined : defs.find((d) => d.key === key);
}

/** Which value widget a {field, op} pair needs. */
export function valueInputFor(
  field: SegmentField,
  op: SegmentOp,
  defs: AttributeDefRow[],
): ValueInput {
  if ((SEGMENT_PRESENCE_OPS as readonly string[]).includes(op)) return { kind: 'none' };
  const type = resolveFieldType(field, defs);
  if (!type) return { kind: 'text' };
  switch (type) {
    case 'tag':
      return { kind: 'tag' };
    case 'boolean':
      return { kind: 'boolean' };
    case 'number':
      return { kind: 'number' };
    case 'date':
      return op === 'older_than_days' || op === 'newer_than_days'
        ? { kind: 'days' }
        : { kind: 'date' };
    case 'text': {
      const def = attributeDef(field, defs);
      if (def && def.type === 'select') return { kind: 'select', options: selectOptions(def) };
      return { kind: 'text' };
    }
  }
}

/** A sensible default value when the field or operator changes. */
export function defaultValueFor(
  field: SegmentField,
  op: SegmentOp,
  defs: AttributeDefRow[],
): string | number | undefined {
  const input = valueInputFor(field, op, defs);
  switch (input.kind) {
    case 'none':
      return undefined;
    case 'number':
      return 0;
    case 'days':
      return 30;
    case 'boolean':
      return 'true';
    case 'select':
      return input.options[0] ?? '';
    case 'date':
    case 'text':
    case 'tag':
      return '';
  }
}

/** First valid operator for a field — the default when a field is chosen. */
export function defaultOperatorFor(field: SegmentField, defs: AttributeDefRow[]): SegmentOp {
  return operatorsForField(field, defs)[0] ?? 'eq';
}

export function fieldLabel(field: SegmentField, defs: AttributeDefRow[]): string {
  if (!isAttributeField(field)) return t(`segments.fields.${field as (typeof SEGMENT_FIELDS)[number]}`);
  return attributeDef(field, defs)?.label ?? field;
}
