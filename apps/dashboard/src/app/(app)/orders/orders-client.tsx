'use client';

/**
 * Orders client (WS-D2 §2): toolbar with the "Entregas de hoy" shortcut and
 * CSV export, filter bar, table with inline status change, pagination, detail
 * drawer and manual creation. Filter state lives in the URL.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Plus, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { t } from '@/i18n/index';
import { todayIsoDate } from '@/lib/format';
import {
  hasActiveOrderFilters,
  serializeOrderFilterModel,
  todayDeliveriesModel,
  PAGE_SIZE,
  type OrderFilterModel,
  type SortField,
} from '@/lib/orders/filter-model';
import { fetchOrdersForExport } from '@/lib/orders/list';
import { setOrderStatus } from '@/lib/orders/mutations';
import { buildExportRows, downloadCsv, exportFileName, toCsv, EXPORT_MAX_ROWS } from '@/lib/orders/csv';
import type { OrderListItem, OrderMasters, OrdersPage } from '@/lib/orders/types';
import { Button } from '@/components/ui/button';
import { OrderFilterBar } from './order-filter-bar';
import { OrderTable } from './order-table';
import { OrderDrawer } from './order-drawer';
import { OrderCreateDrawer } from './order-create-drawer';

export function OrdersClient({
  tenantId,
  currency,
  masters,
  model,
  page,
}: {
  tenantId: string;
  currency: string;
  masters: OrderMasters;
  model: OrderFilterModel;
  page: OrdersPage;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [detail, setDetail] = useState<OrderListItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState(false);
  /** Optimistic status overrides keyed by order id. */
  const [pendingStatus, setPendingStatus] = useState<Record<string, string>>({});

  function navigate(next: OrderFilterModel) {
    const qs = serializeOrderFilterModel(next).toString();
    router.replace(qs ? `/orders?${qs}` : '/orders', { scroll: false });
  }

  function onSort(field: SortField) {
    const dir = model.sort === field && (model.sortDir ?? 'desc') === 'asc' ? 'desc' : 'asc';
    navigate({ ...model, sort: field, sortDir: dir, page: 1 });
  }

  async function onChangeStatus(item: OrderListItem, statusId: string) {
    setPendingStatus((prev) => ({ ...prev, [item.order.id]: statusId }));
    try {
      await setOrderStatus(supabase, item.order.id, statusId);
      toast.success(t('orders.statusChanged'));
      router.refresh();
    } catch {
      setPendingStatus((prev) => {
        const next = { ...prev };
        delete next[item.order.id];
        return next;
      });
      toast.error(t('orders.statusError'));
    }
  }

  async function onExport() {
    setExporting(true);
    try {
      const items = await fetchOrdersForExport(supabase, model, EXPORT_MAX_ROWS);
      if (items.length === 0) {
        toast.error(t('orders.exportEmpty'));
        return;
      }
      downloadCsv(toCsv(buildExportRows(items)), exportFileName(todayIsoDate()));
    } catch {
      toast.error(t('common.errorGeneric'));
    } finally {
      setExporting(false);
    }
  }

  const currentPage = model.page ?? 1;
  const from = (currentPage - 1) * PAGE_SIZE;
  const showingFrom = page.total === 0 ? 0 : from + 1;
  const showingTo = Math.min(from + page.items.length, from + PAGE_SIZE);
  const filtered = hasActiveOrderFilters(model);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between gap-4 border-b bg-background px-6 py-4">
        <h1 className="text-lg font-semibold">{t('orders.title')}</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(todayDeliveriesModel(todayIsoDate()))}
          >
            <Truck className="size-4" />
            {t('orders.todayDeliveries')}
          </Button>
          <Button variant="outline" size="sm" disabled={exporting} onClick={() => void onExport()}>
            <Download className="size-4" />
            {t('orders.exportCsv')}
          </Button>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            {t('orders.newOrder')}
          </Button>
        </div>
      </header>

      <OrderFilterBar masters={masters} model={model} onChange={navigate} />

      <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
        {page.total === 0 && !filtered ? (
          <EmptyState titleKey="orders.emptyNoneTitle" bodyKey="orders.emptyNoneBody" />
        ) : page.total === 0 ? (
          <EmptyState titleKey="orders.emptyFilteredTitle" bodyKey="orders.emptyFilteredBody">
            <Button variant="outline" size="sm" onClick={() => navigate({})}>
              {t('orders.clearFilters')}
            </Button>
          </EmptyState>
        ) : (
          <OrderTable
            items={page.items}
            masters={masters}
            currency={currency}
            model={model}
            pendingStatus={pendingStatus}
            onSort={onSort}
            onChangeStatus={(item, statusId) => void onChangeStatus(item, statusId)}
            onRowClick={setDetail}
          />
        )}

        {page.total > 0 && (
          <div className="flex items-center justify-between py-3 text-sm text-muted-foreground">
            <span>
              {showingFrom}–{showingTo} {t('common.pagination.rangeOf')} {page.total}{' '}
              {t('orders.countLabel')}
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

      <OrderDrawer
        item={detail}
        tenantId={tenantId}
        currency={currency}
        masters={masters}
        supabase={supabase}
        onClose={() => setDetail(null)}
        onReplace={setDetail}
        onChanged={() => router.refresh()}
      />

      <OrderCreateDrawer
        open={creating}
        tenantId={tenantId}
        currency={currency}
        masters={masters}
        supabase={supabase}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          router.refresh();
        }}
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
