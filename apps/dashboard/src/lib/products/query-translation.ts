/**
 * Pure translation: ProductFilterModel → a PostgREST query plan. Kept free of
 * supabase-js so every filter is unit-testable; `list.ts` applies the plan to a
 * real query builder. Same split as the customers directory.
 */
import { PAGE_SIZE, type ProductFilterModel } from './filter-model';

/** One PostgREST filter call. */
export type PlanFilter = {
  method: 'eq' | 'ilike';
  column: string;
  value: string | number | boolean;
};

export interface ProductQueryPlan {
  filters: PlanFilter[];
  sort: { column: string; ascending: boolean };
  rangeFrom: number;
  rangeTo: number;
}

/**
 * Strip PostgREST pattern wildcards and quoting from user search terms rather
 * than attempt escaping (same rule as the customers search).
 */
export function sanitizeSearchTerm(term: string): string {
  return term.replace(/[,()%_\\"']/g, ' ').trim();
}

export function buildProductQueryPlan(model: ProductFilterModel): ProductQueryPlan {
  const filters: PlanFilter[] = [];

  if (model.search) {
    const term = sanitizeSearchTerm(model.search);
    // Name only: descriptions are long marketing copy and matching them makes
    // the catalog search feel random to an owner looking for one garment.
    if (term.length > 0) {
      filters.push({ method: 'ilike', column: 'name', value: `%${term}%` });
    }
  }

  if (model.categoryId) {
    filters.push({ method: 'eq', column: 'category_id', value: model.categoryId });
  }

  if (model.availability) {
    filters.push({
      method: 'eq',
      column: 'available',
      value: model.availability === 'available',
    });
  }

  const page = model.page ?? 1;
  return {
    filters,
    sort: { column: model.sort ?? 'name', ascending: (model.sortDir ?? 'asc') === 'asc' },
    rangeFrom: (page - 1) * PAGE_SIZE,
    rangeTo: page * PAGE_SIZE - 1,
  };
}
