'use client';

/**
 * Orders search + filters (WS-D2 §2). Status and payment apply immediately;
 * the two date ranges live behind a panel with an explicit "Aplicar" so a
 * half-typed range never thrashes the URL (same rule as the customers screen).
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import type { PaymentState } from '@optiax/shared';
import { PAYMENT_STATES } from '@optiax/shared';
import { t } from '@/i18n/index';
import { hasActiveOrderFilters, type OrderFilterModel } from '@/lib/orders/filter-model';
import type { OrderMasters } from '@/lib/orders/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ANY = '__any__';

export function OrderFilterBar({
  masters,
  model,
  onChange,
}: {
  masters: OrderMasters;
  model: OrderFilterModel;
  onChange: (next: OrderFilterModel) => void;
}) {
  const [search, setSearch] = useState(model.search ?? '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modelRef = useRef(model);
  modelRef.current = model;

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

  function setStatus(value: string) {
    const next = { ...model, page: 1 };
    if (value === ANY) delete next.statusId;
    else next.statusId = value;
    onChange(next);
  }

  function setPayment(value: string) {
    const next = { ...model, page: 1 };
    if (value === ANY) delete next.paymentState;
    else next.paymentState = value as PaymentState;
    onChange(next);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-background px-6 py-3">
      <div className="relative">
        <Search className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('orders.searchPlaceholder')}
          className="w-72 pl-8"
        />
      </div>

      <Select value={model.statusId ?? ANY} onValueChange={setStatus}>
        <SelectTrigger size="sm" className="w-52">
          <span className="text-muted-foreground">{t('orders.filters.status')}:</span>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{t('orders.filters.any')}</SelectItem>
          {masters.statuses.map((status) => (
            <SelectItem key={status.id} value={status.id}>
              {status.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={model.paymentState ?? ANY} onValueChange={setPayment}>
        <SelectTrigger size="sm" className="w-64">
          <span className="text-muted-foreground">{t('orders.filters.payment')}:</span>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{t('orders.filters.any')}</SelectItem>
          {PAYMENT_STATES.map((state) => (
            <SelectItem key={state} value={state}>
              {t(`orders.payment.${state}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <DateRangeFilters model={model} onApply={(next) => onChange({ ...next, page: 1 })} />

      {hasActiveOrderFilters(model) && (
        <Button variant="ghost" size="sm" onClick={() => onChange({})}>
          <X className="size-3" />
          {t('orders.clearFilters')}
        </Button>
      )}
    </div>
  );
}

/** Delivery + created ranges. Local draft state, committed on "Aplicar". */
function DateRangeFilters({
  model,
  onApply,
}: {
  model: OrderFilterModel;
  onApply: (next: OrderFilterModel) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const activeCount =
    (model.deliveryFrom || model.deliveryTo ? 1 : 0) +
    (model.createdFrom || model.createdTo ? 1 : 0);

  useEffect(() => {
    if (!open) return;
    setDraft({
      deliveryFrom: model.deliveryFrom ?? '',
      deliveryTo: model.deliveryTo ?? '',
      createdFrom: model.createdFrom ?? '',
      createdTo: model.createdTo ?? '',
    });
  }, [open, model]);

  function set(key: string, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function commit() {
    const next: OrderFilterModel = { ...model };
    delete next.deliveryFrom;
    delete next.deliveryTo;
    delete next.createdFrom;
    delete next.createdTo;
    for (const key of ['deliveryFrom', 'deliveryTo', 'createdFrom', 'createdTo'] as const) {
      const value = draft[key];
      if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) next[key] = value;
    }
    onApply(next);
    setOpen(false);
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          {t('orders.filters.open')}
          {activeCount > 0 && (
            <Badge variant="secondary" className="px-1">
              {activeCount}
            </Badge>
          )}
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 p-3">
        <div className="flex flex-col gap-4">
          <RangeField
            label={t('orders.filters.deliveryRange')}
            fromValue={draft['deliveryFrom'] ?? ''}
            toValue={draft['deliveryTo'] ?? ''}
            onFrom={(value) => set('deliveryFrom', value)}
            onTo={(value) => set('deliveryTo', value)}
          />
          <RangeField
            label={t('orders.filters.createdRange')}
            fromValue={draft['createdFrom'] ?? ''}
            toValue={draft['createdTo'] ?? ''}
            onFrom={(value) => set('createdFrom', value)}
            onTo={(value) => set('createdTo', value)}
          />
          <Button size="sm" onClick={commit}>
            {t('common.apply')}
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RangeField({
  label,
  fromValue,
  toValue,
  onFrom,
  onTo,
}: {
  label: string;
  fromValue: string;
  toValue: string;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-2">
        <Input
          type="date"
          aria-label={`${label} — ${t('orders.filters.from')}`}
          value={fromValue}
          onChange={(e) => onFrom(e.target.value)}
        />
        <Input
          type="date"
          aria-label={`${label} — ${t('orders.filters.to')}`}
          value={toValue}
          onChange={(e) => onTo(e.target.value)}
        />
      </div>
    </div>
  );
}
