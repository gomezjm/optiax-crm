'use client';

/**
 * Status and payment chips (WS-D2 §2/§3). Status colour is keyed off the
 * status *kind*, never its name — tenants rename statuses freely (D4), and a
 * renamed "Enviado" must keep looking like a shipment.
 */
import { t } from '@/i18n/index';
import { cn } from '@/lib/utils';
import type { PaymentState, StatusKind } from '@/lib/orders/types';
import type { OrderStatusRow } from '@/lib/orders/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** Tailwind classes per kind — the §3 palette. */
const KIND_CLASSES: Record<StatusKind, string> = {
  new: 'border-blue-200 bg-blue-50 text-blue-700',
  awaiting_payment: 'border-amber-200 bg-amber-50 text-amber-800',
  awaiting_verification: 'border-amber-200 bg-amber-50 text-amber-800',
  processing: 'border-violet-200 bg-violet-50 text-violet-700',
  shipped: 'border-cyan-200 bg-cyan-50 text-cyan-700',
  delivered: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  cancelled: 'border-border bg-muted text-muted-foreground',
};

export function statusKindClasses(kind: StatusKind): string {
  return KIND_CLASSES[kind];
}

export function StatusBadge({ status }: { status: OrderStatusRow | undefined }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        statusKindClasses(status.kind),
      )}
    >
      {status.name}
    </span>
  );
}

/**
 * Inline status change (§3). Any status → any status: owners fix their own
 * mistakes, and a transition-rule engine would mostly get in their way.
 */
export function StatusSelect({
  statuses,
  value,
  disabled = false,
  onChange,
}: {
  statuses: OrderStatusRow[];
  value: string;
  disabled?: boolean;
  onChange: (statusId: string) => void;
}) {
  const current = statuses.find((status) => status.id === value);
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        size="sm"
        aria-label={t('orders.columns.status')}
        className={cn('w-44', current && statusKindClasses(current.kind))}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {statuses.map((status) => (
          <SelectItem key={status.id} value={status.id}>
            {status.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const PAYMENT_CLASSES: Record<PaymentState, string> = {
  none: 'border-border bg-muted text-muted-foreground',
  reference: 'border-blue-200 bg-blue-50 text-blue-700',
  // The one that needs a human: the owner must look at the screenshot.
  proof_uploaded: 'border-amber-300 bg-amber-50 text-amber-900',
  verified: 'border-emerald-200 bg-emerald-50 text-emerald-700',
};

export function PaymentBadge({ state }: { state: PaymentState }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        PAYMENT_CLASSES[state],
      )}
    >
      {t(`orders.payment.${state}`)}
    </span>
  );
}
