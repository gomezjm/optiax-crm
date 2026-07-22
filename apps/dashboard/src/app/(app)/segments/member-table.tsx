'use client';

/**
 * Read-only member table for the segment preview + detail view (ws-c1 §2). It
 * reuses D1's row primitives — the display-name helper, tag/consent badges and
 * format helpers — so a segment's members render exactly like the customers
 * directory, minus the interactive columns.
 */
import { t } from '@/i18n/index';
import { formatMoney, formatPhone, formatRelative } from '@/lib/format';
import type { CustomerListItem } from '@/lib/customers/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ConsentBadge, TagBadge } from '@/app/(app)/customers/badges';
import { displayName } from '@/app/(app)/customers/customer-table';

export function MemberTable({
  items,
  currency,
}: {
  items: CustomerListItem[];
  currency: string;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('customers.columns.name')}</TableHead>
          <TableHead>{t('customers.columns.phone')}</TableHead>
          <TableHead>{t('customers.columns.tags')}</TableHead>
          <TableHead>{t('customers.columns.consent')}</TableHead>
          <TableHead className="text-right">{t('customers.columns.totalSpent')}</TableHead>
          <TableHead>{t('customers.columns.lastOrder')}</TableHead>
          <TableHead>{t('customers.columns.lastMessage')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.customer.id}>
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
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
