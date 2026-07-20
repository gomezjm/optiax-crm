'use client';

/**
 * Catalog table (WS-D2 §1): sortable headers, thumbnail, the PRD's promo
 * display rule (original struck through) and the one-click availability
 * toggle.
 */
import { ArrowDown, ArrowUp, ImageOff } from 'lucide-react';
import { t } from '@/i18n/index';
import { cn } from '@/lib/utils';
import { formatMoney, formatRelative } from '@/lib/format';
import type { ProductFilterModel, SortField } from '@/lib/products/filter-model';
import type { ProductCategoryRow, ProductListItem } from '@/lib/products/types';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export function ProductTable({
  items,
  categories,
  currency,
  model,
  pendingAvailability,
  onSort,
  onToggleAvailability,
  onRowClick,
}: {
  items: ProductListItem[];
  categories: ProductCategoryRow[];
  currency: string;
  model: ProductFilterModel;
  /** Optimistic overrides keyed by product id. */
  pendingAvailability: Record<string, boolean>;
  onSort: (field: SortField) => void;
  onToggleAvailability: (item: ProductListItem, available: boolean) => void;
  onRowClick: (item: ProductListItem) => void;
}) {
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));

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
          <TableHead className="w-14">{t('products.columns.image')}</TableHead>
          <TableHead>
            <SortHeader field="name" labelKey="products.columns.name" />
          </TableHead>
          <TableHead>{t('products.columns.category')}</TableHead>
          <TableHead className="text-right">
            <SortHeader field="price" labelKey="products.columns.price" />
          </TableHead>
          <TableHead className="text-right">{t('products.columns.promoPrice')}</TableHead>
          <TableHead>{t('products.columns.availability')}</TableHead>
          <TableHead>
            <SortHeader field="updated_at" labelKey="products.columns.updated" />
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => {
          const { product } = item;
          const available = pendingAvailability[product.id] ?? product.available;
          const hasPromo = product.promo_price !== null;
          return (
            <TableRow
              key={product.id}
              className="cursor-pointer"
              onClick={() => onRowClick(item)}
            >
              <TableCell>
                <Thumbnail url={item.imageUrls[0]} alt={product.name} />
              </TableCell>
              <TableCell className="font-medium">{product.name}</TableCell>
              <TableCell className="text-muted-foreground">
                {product.category_id
                  ? (categoryNames.get(product.category_id) ?? t('products.noCategory'))
                  : t('products.noCategory')}
              </TableCell>
              <TableCell
                className={cn(
                  'text-right tabular-nums',
                  // The PRD's promo rule: the original price is struck through
                  // so the discount reads at a glance.
                  hasPromo && 'text-muted-foreground line-through',
                )}
              >
                {formatMoney(product.price, currency)}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {hasPromo ? formatMoney(product.promo_price ?? 0, currency) : '—'}
              </TableCell>
              <TableCell onClick={(e) => e.stopPropagation()}>
                <AvailabilityToggle
                  available={available}
                  onChange={(next) => onToggleAvailability(item, next)}
                />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatRelative(product.updated_at)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function Thumbnail({ url, alt }: { url: string | undefined; alt: string }) {
  if (!url) {
    return (
      <div className="flex size-10 items-center justify-center rounded-md border bg-muted text-muted-foreground">
        <ImageOff className="size-4" />
      </div>
    );
  }
  // A plain <img>, not next/image: these are short-lived signed Storage URLs,
  // so next/image would need a remotePatterns entry per deployment and would
  // cache-bust on every re-sign — for a 40px thumbnail.
  return <img src={url} alt={alt} className="size-10 rounded-md border object-cover" />;
}

/**
 * The "stop selling this NOW" control (§1). A plain button rather than a
 * switch primitive: it must read as state *and* be one click from the list,
 * and it announces itself as a switch to assistive tech.
 */
function AvailabilityToggle({
  available,
  onChange,
}: {
  available: boolean;
  onChange: (available: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={available}
      aria-label={t('products.columns.availability')}
      onClick={() => onChange(!available)}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors',
        available
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
          : 'border-border bg-muted text-muted-foreground hover:bg-muted/70',
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          available ? 'bg-emerald-500' : 'bg-muted-foreground/50',
        )}
      />
      {available ? t('products.availability.available') : t('products.availability.unavailable')}
    </button>
  );
}
