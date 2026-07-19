/**
 * Pure translation: CustomerFilterModel → a PostgREST query plan. Kept free of
 * supabase-js so every filter type is unit-testable; `list.ts` applies the
 * plan to a real query builder.
 */
import { PAGE_SIZE, type CustomerFilterModel } from './filter-model';

/** One PostgREST filter call. `or` values are raw or-expression strings. */
export type PlanFilter =
  | { method: 'or'; value: string }
  | { method: 'in'; column: string; value: string[] }
  | { method: 'eq' | 'gte' | 'lte' | 'ilike'; column: string; value: string | number | boolean };

export interface CustomerQueryPlan {
  /** Inner-join customer_tags (only when a tag filter is active). */
  needsTagJoin: boolean;
  filters: PlanFilter[];
  sort: { column: string; ascending: boolean };
  rangeFrom: number;
  rangeTo: number;
}

/**
 * PostgREST `or=` expressions use `,` `(` `)` as syntax; strip them (plus
 * pattern wildcards) from user search terms rather than attempt escaping.
 */
export function sanitizeSearchTerm(term: string): string {
  return term.replace(/[,()%_\\"']/g, ' ').trim();
}

export function buildCustomerQueryPlan(
  model: CustomerFilterModel,
  now: Date = new Date(),
): CustomerQueryPlan {
  const filters: PlanFilter[] = [];

  if (model.search) {
    const term = sanitizeSearchTerm(model.search);
    if (term.length > 0) {
      filters.push({
        method: 'or',
        value: `name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`,
      });
    }
  }

  const needsTagJoin = Boolean(model.tagIds && model.tagIds.length > 0);
  if (model.tagIds && model.tagIds.length > 0) {
    filters.push({ method: 'in', column: 'customer_tags.tag_id', value: model.tagIds });
  }

  if (model.consent) filters.push({ method: 'eq', column: 'consent_status', value: model.consent });
  if (model.source) filters.push({ method: 'eq', column: 'source', value: model.source });

  for (const attr of model.attributes ?? []) {
    switch (attr.type) {
      case 'select':
        // ->> text comparison: select values are stored as jsonb strings.
        filters.push({ method: 'eq', column: `attributes->>${attr.key}`, value: attr.value });
        break;
      case 'boolean':
        // -> jsonb comparison so `true`/`false` match jsonb booleans.
        filters.push({ method: 'eq', column: `attributes->${attr.key}`, value: attr.value });
        break;
      case 'text': {
        const term = sanitizeSearchTerm(attr.contains);
        if (term.length > 0) {
          filters.push({
            method: 'ilike',
            column: `attributes->>${attr.key}`,
            value: `%${term}%`,
          });
        }
        break;
      }
      case 'number':
        // -> jsonb comparison: jsonb numbers order numerically.
        if (attr.min !== undefined) {
          filters.push({ method: 'gte', column: `attributes->${attr.key}`, value: attr.min });
        }
        if (attr.max !== undefined) {
          filters.push({ method: 'lte', column: `attributes->${attr.key}`, value: attr.max });
        }
        break;
      case 'date':
        // ->> text comparison: ISO dates order lexicographically.
        if (attr.min !== undefined) {
          filters.push({ method: 'gte', column: `attributes->>${attr.key}`, value: attr.min });
        }
        if (attr.max !== undefined) {
          filters.push({ method: 'lte', column: `attributes->>${attr.key}`, value: attr.max });
        }
        break;
    }
  }

  if (model.totalSpentMin !== undefined) {
    filters.push({ method: 'gte', column: 'total_spent', value: model.totalSpentMin });
  }
  if (model.totalSpentMax !== undefined) {
    filters.push({ method: 'lte', column: 'total_spent', value: model.totalSpentMax });
  }

  const dayMs = 24 * 60 * 60 * 1000;
  if (model.lastOrderOlderThanDays !== undefined) {
    const cutoff = new Date(now.getTime() - model.lastOrderOlderThanDays * dayMs);
    filters.push({ method: 'lte', column: 'last_order_at', value: cutoff.toISOString() });
  }
  if (model.lastOrderNewerThanDays !== undefined) {
    const cutoff = new Date(now.getTime() - model.lastOrderNewerThanDays * dayMs);
    filters.push({ method: 'gte', column: 'last_order_at', value: cutoff.toISOString() });
  }

  const page = model.page ?? 1;
  return {
    needsTagJoin,
    filters,
    sort: { column: model.sort ?? 'name', ascending: (model.sortDir ?? 'asc') === 'asc' },
    rangeFrom: (page - 1) * PAGE_SIZE,
    rangeTo: page * PAGE_SIZE - 1,
  };
}
