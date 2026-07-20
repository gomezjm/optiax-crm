'use client';

/**
 * Catalog search + filters (WS-D2 §1). All three apply immediately — there is
 * no half-typed range to protect here, so the customers screen's "Aplicar"
 * panel would just add a click.
 */
import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { t } from '@/i18n/index';
import type { Availability, ProductFilterModel } from '@/lib/products/filter-model';
import { hasActiveProductFilters } from '@/lib/products/filter-model';
import type { ProductCategoryRow } from '@/lib/products/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ANY = '__any__';

export function ProductFilterBar({
  categories,
  model,
  onChange,
}: {
  categories: ProductCategoryRow[];
  model: ProductFilterModel;
  onChange: (next: ProductFilterModel) => void;
}) {
  const [search, setSearch] = useState(model.search ?? '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modelRef = useRef(model);
  modelRef.current = model;

  // Keep the input in sync when the URL changes from elsewhere (clear filters).
  useEffect(() => {
    setSearch(model.search ?? '');
  }, [model.search]);

  function onSearchChange(value: string) {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const next = { ...modelRef.current, page: 1 };
      if (value.trim()) next.search = value.trim();
      else delete next.search;
      onChange(next);
    }, 350);
  }

  /** "any" drops the key entirely so it never reaches the URL. */
  function setCategory(value: string) {
    const next = { ...model, page: 1 };
    if (value === ANY) delete next.categoryId;
    else next.categoryId = value;
    onChange(next);
  }

  function setAvailability(value: string) {
    const next = { ...model, page: 1 };
    if (value === ANY) delete next.availability;
    else next.availability = value as Availability;
    onChange(next);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-background px-6 py-3">
      <div className="relative">
        <Search className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('products.searchPlaceholder')}
          className="w-72 pl-8"
        />
      </div>

      <Select
        value={model.categoryId ?? ANY}
        onValueChange={setCategory}
      >
        <SelectTrigger size="sm" className="w-52">
          <span className="text-muted-foreground">{t('products.filters.category')}:</span>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{t('products.filters.any')}</SelectItem>
          {categories.map((category) => (
            <SelectItem key={category.id} value={category.id}>
              {category.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={model.availability ?? ANY}
        onValueChange={setAvailability}
      >
        <SelectTrigger size="sm" className="w-52">
          <span className="text-muted-foreground">{t('products.filters.availability')}:</span>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{t('products.filters.anyAvailability')}</SelectItem>
          <SelectItem value="available">{t('products.availability.available')}</SelectItem>
          <SelectItem value="unavailable">{t('products.availability.unavailable')}</SelectItem>
        </SelectContent>
      </Select>

      {hasActiveProductFilters(model) && (
        <Button variant="ghost" size="sm" onClick={() => onChange({})}>
          <X className="size-3" />
          {t('products.clearFilters')}
        </Button>
      )}
    </div>
  );
}
