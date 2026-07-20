'use client';

/**
 * Customers directory client: toolbar (search/filters/new/import), table with
 * selection + sort, pagination, mass-edit bar, detail drawer. All filter state
 * lives in the URL; data arrives from the server component and refreshes via
 * router.refresh().
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Upload } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { t } from '@/i18n/index';
import {
  hasActiveFilters,
  serializeFilterModel,
  PAGE_SIZE,
  type CustomerFilterModel,
  type SortField,
} from '@/lib/customers/filter-model';
import type { AttributeDefRow, CustomerListItem, CustomersPage, TagRow } from '@/lib/customers/types';
import { fetchCustomerById, fetchMatchingCustomerIds } from '@/lib/customers/list';
import { MASS_EDIT_MAX_ROWS } from '@/lib/customers/mass-edit';
import { Button } from '@/components/ui/button';
import { FilterBar } from './filter-bar';
import { CustomerTable } from './customer-table';
import { MassEditBar } from './mass-edit-bar';
import { CustomerDrawer, type DrawerState } from './customer-drawer';

export function CustomersClient({
  tenantId,
  currency,
  defs,
  tags,
  model,
  page,
}: {
  tenantId: string;
  currency: string;
  defs: AttributeDefRow[];
  tags: TagRow[];
  model: CustomerFilterModel;
  page: CustomersPage;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatchingIds, setAllMatchingIds] = useState<string[] | null>(null);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);

  // New server data invalidates the selection (ids may have left the filter).
  useEffect(() => {
    setSelected(new Set());
    setAllMatchingIds(null);
  }, [page]);

  /**
   * `?customer=<id>` opens that customer's drawer directly — the deep link the
   * orders screen links to. The id is fetched rather than looked up in `page`
   * because the customer usually isn't on the current filtered page at all.
   */
  const deepLinkedCustomerId = searchParams.get('customer');
  useEffect(() => {
    if (!deepLinkedCustomerId) return;
    let cancelled = false;
    void fetchCustomerById(supabase, deepLinkedCustomerId).then((found) => {
      if (!cancelled && found) {
        setDrawer({ mode: 'edit', item: { customer: found.customer, tags: found.tags } });
      }
    }, () => {});
    return () => {
      cancelled = true;
    };
  }, [deepLinkedCustomerId, supabase]);

  function navigate(next: CustomerFilterModel) {
    const params = serializeFilterModel(next);
    const qs = params.toString();
    router.replace(qs ? `/customers?${qs}` : '/customers', { scroll: false });
  }

  function onSort(field: SortField) {
    const dir = model.sort === field && (model.sortDir ?? 'asc') === 'asc' ? 'desc' : 'asc';
    navigate({ ...model, sort: field, sortDir: dir, page: 1 });
  }

  async function onSelectAllMatching() {
    const ids = await fetchMatchingCustomerIds(supabase, model, MASS_EDIT_MAX_ROWS);
    setAllMatchingIds(ids);
    setSelected(new Set(ids));
  }

  const currentPage = model.page ?? 1;
  const from = (currentPage - 1) * PAGE_SIZE;
  const showingFrom = page.total === 0 ? 0 : from + 1;
  const showingTo = Math.min(from + page.items.length, from + PAGE_SIZE);
  const filtered = hasActiveFilters(model);

  const selectionIds = allMatchingIds ?? [...selected];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between gap-4 border-b bg-background px-6 py-4">
        <h1 className="text-lg font-semibold">{t('customers.title')}</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/customers/import">
              <Upload className="size-4" />
              {t('customers.importCsv')}
            </Link>
          </Button>
          <Button size="sm" onClick={() => setDrawer({ mode: 'create' })}>
            <Plus className="size-4" />
            {t('customers.newCustomer')}
          </Button>
        </div>
      </header>

      <FilterBar defs={defs} tags={tags} model={model} onChange={navigate} />

      <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
        {page.total === 0 && !filtered ? (
          <EmptyState titleKey="customers.emptyNoneTitle" bodyKey="customers.emptyNoneBody" />
        ) : page.total === 0 ? (
          <EmptyState titleKey="customers.emptyFilteredTitle" bodyKey="customers.emptyFilteredBody">
            <Button variant="outline" size="sm" onClick={() => navigate({})}>
              {t('customers.clearFilters')}
            </Button>
          </EmptyState>
        ) : (
          <CustomerTable
            items={page.items}
            currency={currency}
            model={model}
            selected={selected}
            onSort={onSort}
            onToggle={(id, on) => {
              setAllMatchingIds(null);
              setSelected((prev) => {
                const next = new Set(prev);
                if (on) next.add(id);
                else next.delete(id);
                return next;
              });
            }}
            onTogglePage={(on) => {
              setAllMatchingIds(null);
              setSelected(on ? new Set(page.items.map((i) => i.customer.id)) : new Set());
            }}
            onRowClick={(item: CustomerListItem) => setDrawer({ mode: 'edit', item })}
          />
        )}

        {page.total > 0 && (
          <div className="flex items-center justify-between py-3 text-sm text-muted-foreground">
            <span>
              {showingFrom}–{showingTo} {t('customers.pagination.rangeOf')} {page.total}{' '}
              {t('customers.countLabel')}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => navigate({ ...model, page: currentPage - 1 })}
              >
                {t('customers.pagination.previous')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={from + PAGE_SIZE >= page.total}
                onClick={() => navigate({ ...model, page: currentPage + 1 })}
              >
                {t('customers.pagination.next')}
              </Button>
            </div>
          </div>
        )}
      </div>

      {selectionIds.length > 0 && (
        <MassEditBar
          tenantId={tenantId}
          supabase={supabase}
          customerIds={selectionIds}
          allMatching={allMatchingIds !== null}
          canSelectAllMatching={
            allMatchingIds === null && selected.size === page.items.length && page.total > page.items.length
          }
          defs={defs}
          tags={tags}
          onSelectAllMatching={() => void onSelectAllMatching()}
          onClear={() => {
            setSelected(new Set());
            setAllMatchingIds(null);
          }}
          onDone={() => router.refresh()}
        />
      )}

      <CustomerDrawer
        state={drawer}
        tenantId={tenantId}
        currency={currency}
        defs={defs}
        tags={tags}
        supabase={supabase}
        onClose={() => setDrawer(null)}
        onOpenCustomer={(item) => setDrawer({ mode: 'edit', item })}
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
