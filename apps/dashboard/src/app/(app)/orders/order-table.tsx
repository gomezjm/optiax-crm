'use client';

/** Orders table (WS-D2 §2): sortable headers, inline status change, chips. */
import { ArrowDown, ArrowUp } from 'lucide-react';
import { paymentState } from '@optiax/shared';
import { t } from '@/i18n/index';
import { formatDateOnly, formatMoney, formatRelative } from '@/lib/format';
import type { OrderFilterModel, SortField } from '@/lib/orders/filter-model';
import { truncateItemsSummary } from '@/lib/orders/summary';
import { shortOrderId, type OrderListItem, type OrderMasters } from '@/lib/orders/types';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PaymentBadge, StatusSelect } from './order-badges';

export function OrderTable({
  items,
  masters,
  currency,
  model,
  pendingStatus,
  onSort,
  onChangeStatus,
  onRowClick,
}: {
  items: OrderListItem[];
  masters: OrderMasters;
  currency: string;
  model: OrderFilterModel;
  /** Optimistic status overrides keyed by order id. */
  pendingStatus: Record<string, string>;
  onSort: (field: SortField) => void;
  onChangeStatus: (item: OrderListItem, statusId: string) => void;
  onRowClick: (item: OrderListItem) => void;
}) {
  function SortHeader({ field, labelKey }: { field: SortField; labelKey: Parameters<typeof t>[0] }) {
    const active = model.sort === field || (model.sort === undefined && field === 'created_at');
    const ascending = (model.sortDir ?? 'desc') === 'asc';
    return (
      <button
        type="button"
        className="flex items-center gap-1 font-medium hover:text-foreground"
        onClick={() => onSort(field)}
      >
        {t(labelKey)}
        {active && (ascending ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('orders.columns.id')}</TableHead>
          <TableHead>{t('orders.columns.customer')}</TableHead>
          <TableHead>{t('orders.columns.items')}</TableHead>
          <TableHead className="text-right">
            <SortHeader field="total" labelKey="orders.columns.total" />
          </TableHead>
          <TableHead>{t('orders.columns.status')}</TableHead>
          <TableHead>{t('orders.columns.payment')}</TableHead>
          <TableHead>
            <SortHeader field="delivery_date" labelKey="orders.columns.deliveryDate" />
          </TableHead>
          <TableHead>{t('orders.columns.source')}</TableHead>
          <TableHead>
            <SortHeader field="created_at" labelKey="orders.columns.created" />
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => {
          const { order } = item;
          const summary = truncateItemsSummary(item.items);
          return (
            <TableRow key={order.id} className="cursor-pointer" onClick={() => onRowClick(item)}>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {shortOrderId(order.id)}
              </TableCell>
              <TableCell className="font-medium">
                {item.customer?.name ?? t('inbox.unnamedCustomer')}
              </TableCell>
              <TableCell className="max-w-64 truncate text-muted-foreground">
                {summary.text}
                {summary.remaining > 0 && (
                  <span className="ml-1">
                    {t('orders.itemsMore').replace('{count}', String(summary.remaining))}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatMoney(order.total, currency)}
              </TableCell>
              <TableCell onClick={(e) => e.stopPropagation()}>
                <StatusSelect
                  statuses={masters.statuses}
                  value={pendingStatus[order.id] ?? order.status_id}
                  onChange={(statusId) => onChangeStatus(item, statusId)}
                />
              </TableCell>
              <TableCell>
                <PaymentBadge state={paymentState(order)} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDateOnly(order.delivery_date)}
              </TableCell>
              <TableCell>
                <Badge variant="outline">{t(`orders.source.${order.source}`)}</Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatRelative(order.created_at)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
