'use client';

/**
 * Payment methods (WS-D4 §2): the accounts/wallets the agent shares when
 * `orders.sharePaymentMethods` is on, and D2's order drawer offers. Simple CRUD
 * — label, details, enabled — over an admin-write table.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { t } from '@/i18n/index';
import type { DashboardSupabaseClient } from '@/lib/supabase/types';
import type { PaymentMethodRow } from '@/lib/settings/types';
import {
  createPaymentMethod,
  deletePaymentMethod,
  updatePaymentMethod,
} from '@/lib/settings/mutations';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Editing {
  id: string | null; // null → creating
  label: string;
  details: string;
  enabled: boolean;
}

const BLANK: Editing = { id: null, label: '', details: '', enabled: true };

export function PaymentMethodsSection({
  tenantId,
  supabase,
  methods,
  onChanged,
}: {
  tenantId: string;
  supabase: DashboardSupabaseClient;
  methods: PaymentMethodRow[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<PaymentMethodRow | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSave() {
    if (!editing) return;
    const label = editing.label.trim();
    const details = editing.details.trim();
    if (label === '' || details === '') return;
    setSaving(true);
    try {
      if (editing.id === null) {
        await createPaymentMethod(supabase, tenantId, { label, details, enabled: editing.enabled });
        toast.success(t('settings.payments.created'));
      } else {
        await updatePaymentMethod(supabase, editing.id, { label, details, enabled: editing.enabled });
        toast.success(t('settings.payments.updated'));
      }
      setEditing(null);
      onChanged();
    } catch {
      toast.error(t('common.errorGeneric'));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!deleting) return;
    setSaving(true);
    try {
      await deletePaymentMethod(supabase, deleting.id);
      toast.success(t('settings.payments.deleted'));
      setDeleting(null);
      onChanged();
    } catch {
      toast.error(t('common.errorGeneric'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Wallet className="size-4" />
            {t('settings.payments.title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('settings.payments.description')}</p>
        </div>
        <Button size="sm" onClick={() => setEditing({ ...BLANK })}>
          <Plus className="size-4" />
          {t('settings.payments.add')}
        </Button>
      </div>

      {methods.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          {t('settings.payments.empty')}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {methods.map((method) => (
            <li key={method.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className="truncate">{method.label}</span>
                  {!method.enabled && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {t('settings.payments.enabled')}: {t('common.no')}
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">{method.details}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('common.edit')}
                onClick={() =>
                  setEditing({
                    id: method.id,
                    label: method.label,
                    details: method.details,
                    enabled: method.enabled,
                  })
                }
              >
                <Pencil className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('common.delete')}
                onClick={() => setDeleting(method)}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* Create / edit dialog */}
      <Dialog open={editing !== null} onOpenChange={(open) => (!open ? setEditing(null) : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing?.id === null ? t('settings.payments.add') : t('common.edit')}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="pm-label">{t('settings.payments.label')}</Label>
                <Input
                  id="pm-label"
                  value={editing.label}
                  onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pm-details">{t('settings.payments.details')}</Label>
                <Textarea
                  id="pm-details"
                  rows={3}
                  value={editing.details}
                  onChange={(e) => setEditing({ ...editing, details: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">{t('settings.payments.detailsHint')}</p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={editing.enabled}
                  onCheckedChange={(v) => setEditing({ ...editing, enabled: v === true })}
                />
                {t('settings.payments.enabled')}
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </Button>
            <Button disabled={saving} onClick={() => void onSave()}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={deleting !== null} onOpenChange={(open) => (!open ? setDeleting(null) : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.payments.deleteTitle')}</DialogTitle>
            <DialogDescription>
              {t('settings.payments.deleteBody').replace('{label}', deleting?.label ?? '')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" disabled={saving} onClick={() => void onDelete()}>
              {saving ? t('common.deleting') : t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
