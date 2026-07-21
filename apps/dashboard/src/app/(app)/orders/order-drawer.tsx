'use client';

/**
 * Order detail drawer (WS-D2 §2). Status changes apply immediately (same rule
 * as the list); payment and logistics are edited as a form and saved together.
 * Items are read-only after creation — see SESSION_NOTES.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, ImageOff, MessageSquare, Upload, User } from 'lucide-react';
import { toast } from 'sonner';
import { computeOrderTotal, paymentState } from '@optiax/shared';
import { t, type TranslationKey } from '@/i18n/index';
import type { DashboardSupabaseClient } from '@/lib/supabase/types';
import { formatDateTime, formatMoney, formatPhone } from '@/lib/format';
import { signMediaPath } from '@/lib/media';
import { uploadOrderProof } from '@/lib/products/images';
import {
  fetchConversationIdForCustomer,
  fetchOrderById,
  fetchVerifierName,
} from '@/lib/orders/list';
import { setOrderStatus, setPaymentVerified, updateOrder } from '@/lib/orders/mutations';
import { formatItemsSummary } from '@/lib/orders/summary';
import { shortOrderId, type OrderListItem, type OrderMasters } from '@/lib/orders/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PaymentBadge, StatusSelect } from './order-badges';

const NO_METHOD = '__none__';

interface FormState {
  paymentMethodId: string;
  paymentReference: string;
  deliveryAddress: string;
  deliveryDate: string;
  driverNotes: string;
}

function formFromItem(item: OrderListItem): FormState {
  return {
    paymentMethodId: item.order.payment_method_id ?? '',
    paymentReference: item.order.payment_reference ?? '',
    deliveryAddress: item.order.delivery_address ?? '',
    deliveryDate: item.order.delivery_date ?? '',
    driverNotes: item.order.driver_notes ?? '',
  };
}

export function OrderDrawer({
  item,
  tenantId,
  currency,
  timezone,
  masters,
  supabase,
  onClose,
  onReplace,
  onChanged,
}: {
  item: OrderListItem | null;
  tenantId: string;
  currency: string;
  timezone: string;
  masters: OrderMasters;
  supabase: DashboardSupabaseClient;
  onClose: () => void;
  /** Swap the drawer's item for a refreshed copy after a save. */
  onReplace: (item: OrderListItem) => void;
  onChanged: () => void;
}) {
  const [form, setForm] = useState<FormState>({
    paymentMethodId: '',
    paymentReference: '',
    deliveryAddress: '',
    deliveryDate: '',
    driverNotes: '',
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [verifierName, setVerifierName] = useState<string | null>(null);

  useEffect(() => {
    setProofUrl(null);
    setConversationId(null);
    setVerifierName(null);
    if (!item) return;
    setForm(formFromItem(item));
    void signMediaPath(supabase, item.order.payment_proof_media_path).then(setProofUrl, () => {});
    void fetchVerifierName(supabase, item.order.verified_by).then(setVerifierName, () => {});
    if (item.customer) {
      void fetchConversationIdForCustomer(supabase, item.customer.id).then(
        setConversationId,
        () => {},
      );
    }
  }, [item, supabase]);

  /** Re-read the order so the drawer reflects exactly what the DB now holds. */
  async function refresh(orderId: string) {
    const fresh = await fetchOrderById(supabase, orderId);
    if (fresh) onReplace(fresh);
    onChanged();
  }

  async function onChangeStatus(statusId: string) {
    if (!item) return;
    try {
      await setOrderStatus(supabase, item.order.id, statusId);
      toast.success(t('orders.statusChanged'));
      await refresh(item.order.id);
    } catch {
      toast.error(t('orders.statusError'));
    }
  }

  async function onSave() {
    if (!item) return;
    setSaving(true);
    try {
      await updateOrder(supabase, item.order.id, {
        payment_method_id: form.paymentMethodId === '' ? null : form.paymentMethodId,
        payment_reference: form.paymentReference,
        delivery_address: form.deliveryAddress,
        delivery_date: form.deliveryDate === '' ? null : form.deliveryDate,
        driver_notes: form.driverNotes,
      });
      toast.success(t('orders.drawer.saved'));
      await refresh(item.order.id);
    } catch {
      toast.error(t('orders.drawer.saveError'));
    } finally {
      setSaving(false);
    }
  }

  async function onToggleVerified(verified: boolean) {
    if (!item) return;
    setSaving(true);
    try {
      await setPaymentVerified(supabase, item.order.id, verified);
      await refresh(item.order.id);
    } catch {
      toast.error(t('orders.drawer.saveError'));
    } finally {
      setSaving(false);
    }
  }

  async function onUploadProof(file: File | undefined) {
    if (!file || !item) return;
    if (!file.type.startsWith('image/')) {
      toast.error(t('products.images.notAnImage'));
      return;
    }
    setUploading(true);
    try {
      const path = await uploadOrderProof(supabase, tenantId, item.order.id, file);
      await updateOrder(supabase, item.order.id, { payment_proof_media_path: path });
      await refresh(item.order.id);
    } catch {
      toast.error(t('products.images.uploadError'));
    } finally {
      setUploading(false);
    }
  }

  const status = item
    ? masters.statuses.find((candidate) => candidate.id === item.order.status_id)
    : undefined;
  const itemsTotal = item ? computeOrderTotal(item.items) : 0;

  return (
    <Sheet open={item !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{t('orders.drawer.title')}</SheetTitle>
          <SheetDescription className="font-mono text-xs">
            {item ? shortOrderId(item.order.id) : null}
          </SheetDescription>
        </SheetHeader>

        {item && (
          <div className="flex flex-col gap-6 px-4 pb-6">
            <section className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3">
              <h3 className="text-sm font-medium">{t('orders.drawer.customerSection')}</h3>
              <div className="text-sm">
                <div className="font-medium">
                  {item.customer?.name ?? t('inbox.unnamedCustomer')}
                </div>
                <div className="text-muted-foreground">
                  {formatPhone(item.customer?.phone ?? item.customer?.wa_id ?? null)}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {item.customer && (
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/customers?customer=${item.customer.id}`}>
                      <User className="size-4" />
                      {t('orders.drawer.viewCustomer')}
                    </Link>
                  </Button>
                )}
                {conversationId && (
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/inbox?conversation=${conversationId}`}>
                      <MessageSquare className="size-4" />
                      {t('orders.drawer.viewConversation')}
                    </Link>
                  </Button>
                )}
                {item.customer?.wa_id && (
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href={`https://wa.me/${item.customer.wa_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="size-4" />
                      {t('customers.drawer.openWhatsapp')}
                    </a>
                  </Button>
                )}
              </div>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">{t('orders.drawer.itemsSection')}</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('orders.drawer.itemProduct')}</TableHead>
                    <TableHead className="text-right">{t('orders.drawer.itemQty')}</TableHead>
                    <TableHead className="text-right">
                      {t('orders.drawer.itemUnitPrice')}
                    </TableHead>
                    <TableHead className="text-right">
                      {t('orders.drawer.itemSubtotal')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {item.items.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell>{line.description}</TableCell>
                      <TableCell className="text-right tabular-nums">{line.qty}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(line.unit_price, currency)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(line.qty * line.unit_price, currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between border-t pt-2 text-sm font-medium">
                <span>{t('orders.drawer.total')}</span>
                <span className="tabular-nums">{formatMoney(item.order.total, currency)}</span>
              </div>
              {itemsTotal !== item.order.total && (
                // Only reachable if something wrote the order outside this app;
                // showing it beats silently rendering a total nothing justifies.
                <p className="text-xs text-destructive">
                  {formatItemsSummary(item.items)} = {formatMoney(itemsTotal, currency)}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {t('orders.drawer.itemsReadOnly')}
              </p>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">{t('orders.drawer.statusSection')}</h3>
              <StatusSelect
                statuses={masters.statuses}
                value={item.order.status_id}
                disabled={saving}
                onChange={(statusId) => void onChangeStatus(statusId)}
              />
              {status && (
                <p className="text-xs text-muted-foreground">
                  {t('orders.drawer.createdAt')}: {formatDateTime(item.order.created_at, timezone)}
                </p>
              )}
            </section>

            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">{t('orders.drawer.paymentSection')}</h3>
                <PaymentBadge state={paymentState(item.order)} />
              </div>

              <Field labelKey="orders.drawer.paymentMethod">
                <Select
                  value={form.paymentMethodId === '' ? NO_METHOD : form.paymentMethodId}
                  onValueChange={(value) =>
                    setForm({ ...form, paymentMethodId: value === NO_METHOD ? '' : value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_METHOD}>{t('common.none')}</SelectItem>
                    {masters.paymentMethods.map((method) => (
                      <SelectItem key={method.id} value={method.id}>
                        {method.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field labelKey="orders.drawer.paymentReference">
                <Input
                  value={form.paymentReference}
                  onChange={(e) => setForm({ ...form, paymentReference: e.target.value })}
                />
              </Field>

              <div className="flex flex-col gap-2">
                <Label className="text-xs">{t('orders.drawer.paymentProof')}</Label>
                {proofUrl ? (
                  <a href={proofUrl} target="_blank" rel="noopener noreferrer">
                    {/* Plain <img> on a signed Storage URL — see the
                        rationale in product-table.tsx. */}
                    <img
                      src={proofUrl}
                      alt={t('orders.drawer.paymentProof')}
                      className="max-h-64 rounded-md border object-contain"
                    />
                  </a>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <ImageOff className="size-4" />
                    {t('orders.drawer.proofMissing')}
                  </div>
                )}
                <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-muted/50">
                  <Upload className="size-4" />
                  {uploading ? t('products.images.uploading') : t('orders.drawer.uploadProof')}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploading}
                    onChange={(e) => {
                      void onUploadProof(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>

              {item.order.payment_verified_at === null ? (
                <Button
                  variant="outline"
                  className="w-fit"
                  disabled={saving}
                  onClick={() => void onToggleVerified(true)}
                >
                  {t('orders.drawer.verify')}
                </Button>
              ) : (
                <div className="flex flex-col gap-1 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
                  <span className="font-medium text-emerald-800">
                    {t('orders.drawer.verified')}
                  </span>
                  <span className="text-emerald-800">
                    {verifierName
                      ? `${t('orders.drawer.verifiedBy')} ${verifierName} · ${formatDateTime(item.order.payment_verified_at, timezone)}`
                      : `${t('orders.drawer.verifiedAt')}: ${formatDateTime(item.order.payment_verified_at, timezone)}`}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-fit"
                    disabled={saving}
                    onClick={() => void onToggleVerified(false)}
                  >
                    {t('orders.drawer.unverify')}
                  </Button>
                </div>
              )}
            </section>

            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">{t('orders.drawer.logisticsSection')}</h3>
              <Field labelKey="orders.drawer.deliveryAddress">
                <Textarea
                  rows={2}
                  value={form.deliveryAddress}
                  onChange={(e) => setForm({ ...form, deliveryAddress: e.target.value })}
                />
                {item.customer?.address && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-fit"
                    onClick={() =>
                      setForm({
                        ...form,
                        deliveryAddress: [item.customer?.address, item.customer?.city]
                          .filter(Boolean)
                          .join(', '),
                      })
                    }
                  >
                    {t('orders.drawer.useCustomerAddress')}
                  </Button>
                )}
              </Field>
              <Field labelKey="orders.drawer.deliveryDate">
                <Input
                  type="date"
                  value={form.deliveryDate}
                  onChange={(e) => setForm({ ...form, deliveryDate: e.target.value })}
                />
              </Field>
              <Field labelKey="orders.drawer.driverNotes">
                <Textarea
                  rows={2}
                  value={form.driverNotes}
                  onChange={(e) => setForm({ ...form, driverNotes: e.target.value })}
                />
              </Field>
            </section>

            <div className="flex gap-2">
              <Button onClick={() => void onSave()} disabled={saving}>
                {saving ? t('common.saving') : t('common.save')}
              </Button>
              <Button variant="outline" onClick={onClose}>
                {t('common.close')}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({
  labelKey,
  children,
}: {
  labelKey: TranslationKey;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">{t(labelKey)}</Label>
      {children}
    </div>
  );
}
