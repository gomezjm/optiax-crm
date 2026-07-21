'use client';

/**
 * Order statuses (WS-D4 §2): rename the tenant-facing labels + reorder them over
 * the fixed `kind` set. Owners never add/remove kinds — the pipeline logic
 * depends on them — so there's no create/delete here, only a name input per row
 * and up/down reordering. Colour is keyed off `kind` (D2's palette), so a
 * renamed "Enviado" keeps looking like a shipment.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, ListOrdered } from 'lucide-react';
import { t } from '@/i18n/index';
import type { DashboardSupabaseClient } from '@/lib/supabase/types';
import type { OrderStatusRow } from '@/lib/settings/types';
import { renameOrderStatus, reorderOrderStatuses } from '@/lib/settings/mutations';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { statusKindClasses } from '../orders/order-badges';

export function StatusesSection({
  supabase,
  statuses,
  onChanged,
}: {
  supabase: DashboardSupabaseClient;
  statuses: OrderStatusRow[];
  onChanged: () => void;
}) {
  // Local working copy: reordering is staged, then persisted with "Guardar orden".
  const [ordered, setOrdered] = useState<OrderStatusRow[]>(statuses);
  const [names, setNames] = useState<Record<string, string>>(
    Object.fromEntries(statuses.map((s) => [s.id, s.name])),
  );
  const [savingOrder, setSavingOrder] = useState(false);

  const orderDirty = ordered.some((s, i) => s.id !== statuses[i]?.id);

  function move(index: number, delta: number) {
    const next = [...ordered];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const a = next[index];
    const b = next[target];
    if (!a || !b) return;
    next[index] = b;
    next[target] = a;
    setOrdered(next);
  }

  async function onRename(status: OrderStatusRow) {
    const name = (names[status.id] ?? '').trim();
    if (name === '' || name === status.name) {
      setNames((prev) => ({ ...prev, [status.id]: status.name })); // revert blank
      return;
    }
    try {
      await renameOrderStatus(supabase, status.id, name);
      toast.success(t('settings.statuses.renamed'));
      onChanged();
    } catch {
      toast.error(t('common.errorGeneric'));
      setNames((prev) => ({ ...prev, [status.id]: status.name }));
    }
  }

  async function onSaveOrder() {
    setSavingOrder(true);
    try {
      await reorderOrderStatuses(
        supabase,
        ordered.map((s, i) => ({ id: s.id, sort_order: i + 1 })),
      );
      toast.success(t('settings.statuses.orderSaved'));
      onChanged();
    } catch {
      toast.error(t('common.errorGeneric'));
    } finally {
      setSavingOrder(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <ListOrdered className="size-4" />
            {t('settings.statuses.title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('settings.statuses.description')}</p>
        </div>
        {orderDirty && (
          <Button size="sm" disabled={savingOrder} onClick={() => void onSaveOrder()}>
            {savingOrder ? t('common.saving') : t('settings.statuses.saveOrder')}
          </Button>
        )}
      </div>

      <ul className="divide-y rounded-lg border">
        {ordered.map((status, index) => (
          <li key={status.id} className="flex items-center gap-3 px-4 py-3">
            <span
              className={`inline-flex h-6 items-center rounded-full border px-2 text-xs font-medium ${statusKindClasses(status.kind)}`}
              aria-hidden
            >
              {status.kind}
            </span>
            <Input
              value={names[status.id] ?? ''}
              aria-label={t('settings.statuses.name')}
              className="max-w-xs"
              onChange={(e) => setNames((prev) => ({ ...prev, [status.id]: e.target.value }))}
              onBlur={() => void onRename(status)}
            />
            <div className="ml-auto flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('settings.statuses.moveUp')}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('settings.statuses.moveDown')}
                disabled={index === ordered.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown className="size-4" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
