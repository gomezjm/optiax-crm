/**
 * The shared segment evaluation engine (ws-c1 §1). Pure and tenant-agnostic —
 * it emits the customer-filter portion of a query only; tenant scoping is the
 * caller's (dashboard RLS / C2 tenant repo). Re-exported through the package
 * barrel, so consumers import from `@optiax/shared`.
 */
export {
  segmentRulesToQuery,
  validateSegmentRules,
  buildSegmentPostgrestPlan,
  referencedTagNames,
  SegmentQueryError,
  type SegmentEvalContext,
  type SegmentQuery,
  type SegmentPredicate,
  type SegmentPostgrestPlan,
  type SegmentRuleError,
  type PgColumnOp,
  type PgFilter,
  type TagResolution,
} from './query.js';

export {
  fieldType,
  isAttributeField,
  attributeKey,
  attributeTypeToFieldType,
  opsForFieldType,
  isOpValidForFieldType,
  type SegmentFieldType,
} from './fields.js';

export { dayCutoff, type DayCutoff } from './date-bounds.js';
