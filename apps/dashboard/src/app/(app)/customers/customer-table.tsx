'use client';

/** Customers table (WS-D1 §2): sortable headers, selection, badge columns. */
import { ArrowDown, ArrowUp } from 'lucide-react';
import { t } from '@/i18n/index';
import { formatMoney, formatPhone, formatRelative } from '@/lib/format';
import type { CustomerFilterModel, SortField } from '@/lib/customers/filter-model';
import type { CustomerListItem } from '@/lib/customers/types';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ConsentBadge, TagBadge } from './badges';

export function displayName(item: CustomerListItem): string {
  return (
    item.customer.name ??
    item.customer.phone ??
    item.customer.wa_id ??
    t('customers.unnamed')
  );
}

export function CustomerTable({
  items,
  currency,
  model,
  selected,
  onSort,
  onToggle,
  onTogglePage,
  onRowClick,
}: {
  items: CustomerListItem[];
  currency: string;
  model: CustomerFilterModel;
  selected: Set<string>;
  onSort: (field: SortField) => void;
  onToggle: (id: string, on: boolean) => void;
  onTogglePage: (on: boolean) => void;
  onRowClick: (item: CustomerListItem) => void;
}) {
  const allOnPageSelected = items.length > 0 && items.every((i) => selected.has(i.customer.id));

  function SortHeader({ field, labelKey }: { field: SortField; labelKey: Parameters<typeof t>[0] }) {
    const active = model.sort === field || (model.sort === undefined && field === 'name');
    const ascending = (model.sortDir ?? 'asc') === 'asc';
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
          <TableHead className="w-8">
            <Checkbox
              checked={allOnPageSelected}
              onCheckedChange={(checked) => onTogglePage(checked === true)}
            />
          </TableHead>
          <TableHead>
            <SortHeader field="name" labelKey="customers.columns.name" />
          </TableHead>
          <TableHead>{t('customers.columns.phone')}</TableHead>
          <TableHead>{t('customers.columns.tags')}</TableHead>
          <TableHead>{t('customers.columns.consent')}</TableHead>
          <TableHead className="text-right">
            <SortHeader field="total_spent" labelKey="customers.columns.totalSpent" />
          </TableHead>
          <TableHead>
            <SortHeader field="last_order_at" labelKey="customers.columns.lastOrder" />
          </TableHead>
          <TableHead>
            <SortHeader field="last_message_at" labelKey="customers.columns.lastMessage" />
          </TableHead>
          <TableHead>{t('customers.columns.source')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow
            key={item.customer.id}
            className="cursor-pointer"
            onClick={() => onRowClick(item)}
          >
            <TableCell onClick={(e) => e.stopPropagation()}>
              <Checkbox
                checked={selected.has(item.customer.id)}
                onCheckedChange={(checked) => onToggle(item.customer.id, checked === true)}
              />
            </TableCell>
            <TableCell className="font-medium">{displayName(item)}</TableCell>
            <TableCell className="text-muted-foreground">
              {formatPhone(item.customer.phone)}
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {item.tags.map((tag) => (
                  <TagBadge key={tag.id} tag={tag} />
                ))}
              </div>
            </TableCell>
            <TableCell>
              <ConsentBadge status={item.customer.consent_status} />
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatMoney(item.customer.total_spent, currency)}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {formatRelative(item.customer.last_order_at)}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {formatRelative(item.customer.last_message_at)}
            </TableCell>
            <TableCell>
              <Badge variant="outline">{t(`customers.source.${item.customer.source}`)}</Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
