'use client';

/**
 * Catalog client (WS-D2 §1): toolbar, filter bar, table with the availability
 * quick-toggle, pagination, create/edit drawer. Filter state lives in the URL;
 * data arrives from the server component and refreshes via router.refresh().
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { t } from '@/i18n/index';
import {
  hasActiveProductFilters,
  serializeProductFilterModel,
  PAGE_SIZE,
  type ProductFilterModel,
  type SortField,
} from '@/lib/products/filter-model';
import { setProductAvailability } from '@/lib/products/mutations';
import type { ProductCategoryRow, ProductListItem, ProductsPage } from '@/lib/products/types';
import { Button } from '@/components/ui/button';
import { ProductFilterBar } from './product-filter-bar';
import { ProductTable } from './product-table';
import { ProductDrawer, type ProductDrawerState } from './product-drawer';

export function ProductsClient({
  tenantId,
  currency,
  categories,
  model,
  page,
}: {
  tenantId: string;
  currency: string;
  categories: ProductCategoryRow[];
  model: ProductFilterModel;
  page: ProductsPage;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [drawer, setDrawer] = useState<ProductDrawerState | null>(null);

  /**
   * Availability overrides applied on top of server data, so the panic toggle
   * flips instantly instead of waiting for a refresh round-trip.
   */
  const [pending, setPending] = useState<Record<string, boolean>>({});

  function navigate(next: ProductFilterModel) {
    const qs = serializeProductFilterModel(next).toString();
    router.replace(qs ? `/products?${qs}` : '/products', { scroll: false });
  }

  function onSort(field: SortField) {
    const dir = model.sort === field && (model.sortDir ?? 'asc') === 'asc' ? 'desc' : 'asc';
    navigate({ ...model, sort: field, sortDir: dir, page: 1 });
  }

  async function onToggleAvailability(item: ProductListItem, available: boolean) {
    setPending((prev) => ({ ...prev, [item.product.id]: available }));
    try {
      await setProductAvailability(supabase, item.product.id, available);
      router.refresh();
    } catch {
      // Roll the optimistic flip back — the row must not lie about what sells.
      setPending((prev) => {
        const next = { ...prev };
        delete next[item.product.id];
        return next;
      });
      toast.error(t('products.toggleError'));
    }
  }

  const currentPage = model.page ?? 1;
  const from = (currentPage - 1) * PAGE_SIZE;
  const showingFrom = page.total === 0 ? 0 : from + 1;
  const showingTo = Math.min(from + page.items.length, from + PAGE_SIZE);
  const filtered = hasActiveProductFilters(model);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between gap-4 border-b bg-background px-6 py-4">
        <h1 className="text-lg font-semibold">{t('products.title')}</h1>
        <Button size="sm" onClick={() => setDrawer({ mode: 'create' })}>
          <Plus className="size-4" />
          {t('products.newProduct')}
        </Button>
      </header>

      <ProductFilterBar categories={categories} model={model} onChange={navigate} />

      <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
        {page.total === 0 && !filtered ? (
          <EmptyState titleKey="products.emptyNoneTitle" bodyKey="products.emptyNoneBody" />
        ) : page.total === 0 ? (
          <EmptyState titleKey="products.emptyFilteredTitle" bodyKey="products.emptyFilteredBody">
            <Button variant="outline" size="sm" onClick={() => navigate({})}>
              {t('products.clearFilters')}
            </Button>
          </EmptyState>
        ) : (
          <ProductTable
            items={page.items}
            categories={categories}
            currency={currency}
            model={model}
            pendingAvailability={pending}
            onSort={onSort}
            onToggleAvailability={(item, available) => void onToggleAvailability(item, available)}
            onRowClick={(item) => setDrawer({ mode: 'edit', item })}
          />
        )}

        {page.total > 0 && (
          <div className="flex items-center justify-between py-3 text-sm text-muted-foreground">
            <span>
              {showingFrom}–{showingTo} {t('common.pagination.rangeOf')} {page.total}{' '}
              {t('products.countLabel')}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => navigate({ ...model, page: currentPage - 1 })}
              >
                {t('common.pagination.previous')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={from + PAGE_SIZE >= page.total}
                onClick={() => navigate({ ...model, page: currentPage + 1 })}
              >
                {t('common.pagination.next')}
              </Button>
            </div>
          </div>
        )}
      </div>

      <ProductDrawer
        state={drawer}
        tenantId={tenantId}
        currency={currency}
        categories={categories}
        supabase={supabase}
        onClose={() => setDrawer(null)}
        onOpenProduct={(item) => setDrawer({ mode: 'edit', item })}
        onChanged={() => router.refresh()}
      />
    </div>
  );
}

function EmptyState({
  titleKey,
  bodyKey,
  children,
}: {
  titleKey: Parameters<typeof t>[0];
  bodyKey: Parameters<typeof t>[0];
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <h2 className="text-base font-medium">{t(titleKey)}</h2>
      <p className="max-w-md text-sm text-muted-foreground">{t(bodyKey)}</p>
      {children}
    </div>
  );
}
