/**
 * The segment evaluation engine (ws-c1 §1). A pure, tenant-agnostic translator
 * from `SegmentRules` to an executable query, in two stages:
 *
 *   segmentRulesToQuery(rules, ctx)      -> SegmentQuery       (normalized, portable)
 *   buildSegmentPostgrestPlan(query, …)  -> SegmentPostgrestPlan (dashboard executes)
 *
 * The normalized `SegmentQuery` is the shared contract C2's runtime reuses: it
 * keeps tag conditions symbolic (`{ kind: 'tag', tagName }`) so a server-side
 * caller can resolve membership with a real SQL join instead of the id-set the
 * dashboard uses. Date windows are already resolved to concrete cutoffs here, so
 * the descriptor is fully deterministic given `ctx` (notably `ctx.now`).
 *
 * ## Tenant scoping
 *
 * The engine emits the *customer-filter portion only*. It never references a
 * tenant id — tenant isolation is the caller's RLS (dashboard) or tenant repo
 * (C2). Baking a tenant id in here would be a correctness and security bug.
 *
 * ## Tag membership → `id in (…)`
 *
 * PostgREST can't put an embedded/joined column inside an `or=()` expression, so
 * a tag condition can't compose with scalar conditions under the `or`
 * combinator via a join. Instead the dashboard pre-resolves each referenced tag
 * to its member customer-ids and the plan becomes a base-table `id=in.(…)`
 * predicate, which composes freely under both `and` and `or`. (Verified against
 * the live stack before this was written.)
 *
 * ## Edge cases (all covered by the unit suite)
 *
 * - Empty conditions → matches everything (the natural "no filter"). The Zod
 *   schema forbids zero conditions, so this only arises from hand-built input;
 *   the engine defines it anyway.
 * - Unknown `attribute.<key>` (no matching def) → matches nothing, never throws.
 * - `null` field values: SQL comparison against null is "unknown", so `neq`/`lt`/…
 *   naturally exclude null rows; `is_empty`/`is_set` are the explicit presence
 *   checks.
 * - A structurally-impossible condition (operator not valid for the field type,
 *   or a non-numeric value where a number is required) throws `SegmentQueryError`
 *   — stored rules are validated at save time, so this signals corruption, not a
 *   normal empty result. Call `validateSegmentRules` first to surface such
 *   problems as field errors instead.
 */
import type { AttributeType } from '../schemas/masters.js';
import {
  type SegmentCondition,
  type SegmentField,
  type SegmentOp,
  type SegmentRules,
} from '../schemas/segment-rules.js';
import { dayCutoff } from './date-bounds.js';
import {
  attributeKey,
  fieldType,
  isOpValidForFieldType,
  type SegmentFieldType,
} from './fields.js';

/** Inputs the pure engine needs but must not fetch itself. */
export interface SegmentEvalContext {
  /** Evaluation instant. Defaults to `new Date()`; tests/determinism pass it. */
  now?: Date;
  /** Tenant timezone (`tenants.timezone`) for `older_than_days`/`newer_than_days`. */
  timeZone: string;
  /** Attribute key → its def type, for typing `attribute.<key>` comparisons. */
  attributeTypes: Record<string, AttributeType>;
}

export class SegmentQueryError extends Error {
  /** 0-based index of the offending condition, or -1 for a whole-rule problem. */
  readonly conditionIndex: number;
  constructor(message: string, conditionIndex: number) {
    super(message);
    this.name = 'SegmentQueryError';
    this.conditionIndex = conditionIndex;
  }
}

/** Column comparison operators the plan can emit (PostgREST names). */
export type PgColumnOp = 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'ilike' | 'is';

/**
 * One normalized predicate. `column` predicates are concrete base-table/jsonb
 * comparisons; `tag` predicates stay symbolic (membership by tag name);
 * `always-false` is the resolved "unknown attribute → no match".
 */
export type SegmentPredicate =
  | {
      kind: 'column';
      column: string;
      op: PgColumnOp;
      /** For `ilike` this is the ready `%…%` pattern; for `is` it is `null`. */
      value: string | number | boolean | null;
      negate: boolean;
    }
  | { kind: 'tag'; tagName: string; negate: boolean }
  | { kind: 'always-false' };

export interface SegmentQuery {
  combinator: 'and' | 'or';
  predicates: SegmentPredicate[];
}

// ── Translation ─────────────────────────────────────────────────────────────

/** Column expression for a field, given its resolved type. */
function columnFor(field: SegmentField, type: SegmentFieldType): string {
  const key = attributeKey(field);
  if (key === null) return field; // fixed field: column name === field name
  // jsonb: `->` keeps numbers/booleans as jsonb (numeric/boolean ordering);
  // `->>` extracts text (ISO dates compare lexicographically, select/text as text).
  return type === 'number' || type === 'boolean' ? `attributes->${key}` : `attributes->>${key}`;
}

/** jsonb `->>` text form of a field, for presence checks regardless of type. */
function textColumnFor(field: SegmentField): string {
  const key = attributeKey(field);
  return key === null ? field : `attributes->>${key}`;
}

function toNumber(value: string | number | undefined, index: number): number {
  if (typeof value === 'number') return value;
  const n = value === undefined ? NaN : Number(value);
  if (!Number.isFinite(n)) {
    throw new SegmentQueryError(`expected a numeric value, got ${JSON.stringify(value)}`, index);
  }
  return n;
}

function toBoolean(value: string | number | undefined, index: number): boolean {
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  throw new SegmentQueryError(`expected a boolean value, got ${JSON.stringify(value)}`, index);
}

function toText(value: string | number | undefined, index: number): string {
  if (value === undefined) {
    throw new SegmentQueryError('expected a value', index);
  }
  return String(value);
}

/** Strip PostgREST ilike wildcards/injection, wrap as a `%contains%` pattern. */
function ilikePattern(term: string): string {
  return `%${term.replace(/[%_]/g, ' ').trim()}%`;
}

const PRESENCE_OPS: SegmentOp[] = ['is_set', 'is_empty'];

/** Translate one condition into a predicate (or throw for impossible input). */
function translateCondition(
  cond: SegmentCondition,
  index: number,
  ctx: SegmentEvalContext,
  now: Date,
): SegmentPredicate {
  const type = fieldType(cond.field, ctx.attributeTypes);
  // Unknown attribute key → no match, never an error (spec §1).
  if (type === null) return { kind: 'always-false' };

  if (!isOpValidForFieldType(type, cond.op)) {
    throw new SegmentQueryError(
      `operator '${cond.op}' is not valid for field '${cond.field}' (${type})`,
      index,
    );
  }

  // Presence ops apply to any column-backed field (not tag, excluded above).
  if ((PRESENCE_OPS as string[]).includes(cond.op)) {
    return {
      kind: 'column',
      column: textColumnFor(cond.field),
      op: 'is',
      value: null,
      negate: cond.op === 'is_set', // is_set → NOT is null
    };
  }

  if (type === 'tag') {
    const tagName = toText(cond.value, index);
    // eq/contains → member; neq → non-member.
    return { kind: 'tag', tagName, negate: cond.op === 'neq' };
  }

  const column = columnFor(cond.field, type);

  switch (cond.op) {
    case 'older_than_days':
    case 'newer_than_days': {
      const days = toNumber(cond.value, index);
      const cutoff = dayCutoff(now, ctx.timeZone, days);
      // Date columns compare the instant; jsonb date text compares the date.
      const value = type === 'date' && attributeKey(cond.field) === null
        ? cutoff.instantIso
        : cutoff.dateIso;
      // older = before the cutoff (lt); newer = on/after it (gte).
      return {
        kind: 'column',
        column,
        op: cond.op === 'older_than_days' ? 'lt' : 'gte',
        value,
        negate: false,
      };
    }
    case 'contains':
      return {
        kind: 'column',
        column,
        op: 'ilike',
        value: ilikePattern(toText(cond.value, index)),
        negate: false,
      };
    case 'eq':
    case 'neq':
    case 'gt':
    case 'lt':
    case 'gte':
    case 'lte': {
      let value: string | number | boolean;
      if (type === 'number') value = toNumber(cond.value, index);
      else if (type === 'boolean') value = toBoolean(cond.value, index);
      else value = toText(cond.value, index); // text + date (absolute ISO compare)
      return { kind: 'column', column, op: cond.op, value, negate: false };
    }
    default:
      throw new SegmentQueryError(`unsupported operator '${cond.op}'`, index);
  }
}

/**
 * Translate rules into the normalized, portable `SegmentQuery`. Pure: same
 * inputs → same output. Provide `ctx.now` for deterministic date windows.
 */
export function segmentRulesToQuery(rules: SegmentRules, ctx: SegmentEvalContext): SegmentQuery {
  const now = ctx.now ?? new Date();
  return {
    combinator: rules.combinator,
    predicates: rules.conditions.map((cond, i) => translateCondition(cond, i, ctx, now)),
  };
}

// ── Validation (for the rule builder) ───────────────────────────────────────

export interface SegmentRuleError {
  conditionIndex: number;
  message: string;
}

/**
 * Field/op/value compatibility check the Zod schema can't do (it doesn't couple
 * op to field). Returns one error per bad condition so the builder can show
 * inline messages. `unknownAttributeKeys` (optional) flags conditions that
 * reference a missing attribute def — a warning-grade problem: valid to store,
 * but it will match nothing.
 */
export function validateSegmentRules(
  rules: SegmentRules,
  ctx: SegmentEvalContext,
): SegmentRuleError[] {
  const errors: SegmentRuleError[] = [];
  const now = ctx.now ?? new Date();
  rules.conditions.forEach((cond, index) => {
    const type = fieldType(cond.field, ctx.attributeTypes);
    if (type === null) return; // unknown attr key: valid, matches nothing
    if (!isOpValidForFieldType(type, cond.op)) {
      errors.push({
        conditionIndex: index,
        message: `operator '${cond.op}' is not valid for field '${cond.field}'`,
      });
      return;
    }
    try {
      translateCondition(cond, index, ctx, now);
    } catch (err) {
      if (err instanceof SegmentQueryError) {
        errors.push({ conditionIndex: index, message: err.message });
      } else {
        throw err;
      }
    }
  });
  return errors;
}

// ── PostgREST plan ──────────────────────────────────────────────────────────

/** A single filter to apply to a supabase-js query builder (`and` combinator). */
export type PgFilter =
  | { method: 'in'; column: string; values: string[]; negate: boolean }
  | { method: 'is-null'; column: string; negate: boolean }
  | {
      method: 'op';
      column: string;
      op: Exclude<PgColumnOp, 'is'>;
      value: string | number | boolean;
    };

export type SegmentPostgrestPlan =
  | { combinator: 'and'; filters: PgFilter[] }
  /** The inner expression for supabase-js `.or(expression)` (no `or=()` wrapper). */
  | { combinator: 'or'; expression: string };

export interface TagResolution {
  /** Tag name → member customer ids. Missing/empty ⇒ the tag has no members. */
  tagMembers: Record<string, string[]>;
}

/** Resolve a symbolic predicate into a concrete `PgFilter`. */
function predicateToFilter(pred: SegmentPredicate, tags: TagResolution): PgFilter {
  switch (pred.kind) {
    case 'always-false':
      return { method: 'in', column: 'id', values: [], negate: false }; // id in () ⇒ none
    case 'tag': {
      const members = tags.tagMembers[pred.tagName] ?? [];
      return { method: 'in', column: 'id', values: members, negate: pred.negate };
    }
    case 'column':
      if (pred.op === 'is') return { method: 'is-null', column: pred.column, negate: pred.negate };
      return { method: 'op', column: pred.column, op: pred.op, value: pred.value as string | number | boolean };
  }
}

/** Wrap a value for use inside an `or=()` expression (reserved chars → quoted). */
function quoteOrValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Serialize one filter as an `or` term. */
function filterToOrTerm(filter: PgFilter): string {
  switch (filter.method) {
    case 'in': {
      const list = filter.values.join(',');
      return filter.negate ? `${filter.column}.not.in.(${list})` : `${filter.column}.in.(${list})`;
    }
    case 'is-null':
      return filter.negate ? `${filter.column}.not.is.null` : `${filter.column}.is.null`;
    case 'op': {
      if (filter.op === 'ilike') {
        // value is already a sanitized `%…%` pattern; wildcards must stay bare.
        return `${filter.column}.ilike.${filter.value}`;
      }
      const value =
        typeof filter.value === 'string' ? quoteOrValue(filter.value) : String(filter.value);
      return `${filter.column}.${filter.op}.${value}`;
    }
  }
}

/**
 * Build the PostgREST plan the dashboard applies. `and` → a list of filters to
 * chain; `or` → a single inner expression for `.or(…)`. Tag predicates are
 * resolved through `tags.tagMembers` into `id in (…)`.
 */
export function buildSegmentPostgrestPlan(
  query: SegmentQuery,
  tags: TagResolution,
): SegmentPostgrestPlan {
  const filters = query.predicates.map((pred) => predicateToFilter(pred, tags));
  if (query.combinator === 'or') {
    return { combinator: 'or', expression: filters.map(filterToOrTerm).join(',') };
  }
  return { combinator: 'and', filters };
}

/** Tag names referenced by a query — what the caller must resolve to members. */
export function referencedTagNames(query: SegmentQuery): string[] {
  const names = new Set<string>();
  for (const pred of query.predicates) {
    if (pred.kind === 'tag') names.add(pred.tagName);
  }
  return [...names];
}
