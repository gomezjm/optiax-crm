'use client';

/**
 * Manual order creation (WS-D2 §2). The owner logging an offline or
 * phone-ordered sale: pick a customer, add lines from the catalog, confirm the
 * computed total.
 *
 * "Create new customer" reuses D1's `createCustomer` — same phone
 * normalization and duplicate check as the customers screen — through a
 * name+phone form rather than mounting the whole customer drawer, which would
 * need the tenant's attribute defs and tags loaded on every orders render for
 * a rarely-taken path. `CustomerCreateSchema` requires exactly those two
 * fields, so nothing is lost. (See SESSION_NOTES.)
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Plus, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import {
  computeOrderTotal,
  effectivePrice,
  OrderCreateSchema,
  type OrderCreate,
} from '@optiax/shared';
import { t, type TranslationKey } from '@/i18n/index';
import type { DashboardSupabaseClient } from '@/lib/supabase/types';
import { formatMoney, formatPhone } from '@/lib/format';
import { createCustomer } from '@/lib/customers/mutations';
import { fetchCatalogForPicker } from '@/lib/products/list';
import { parsePriceInput } from '@/lib/products/price-input';
import { searchCustomers } from '@/lib/orders/list';
import { createOrder, MissingInitialStatusError } from '@/lib/orders/mutations';
import type { OrderCustomer, OrderMasters } from '@/lib/orders/types';
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

const NO_METHOD = '__none__';

type CatalogEntry = Awaited<ReturnType<typeof fetchCatalogForPicker>>[number];

interface ItemDraft {
  /** Local key — order_items ids don't exist until the insert. */
  key: string;
  productId: string;
  description: string;
  qty: string;
  unitPrice: string;
}

function emptyItem(): ItemDraft {
  return { key: crypto.randomUUID(), productId: '', description: '', qty: '1', unitPrice: '' };
}

export function OrderCreateDrawer({
  open,
  tenantId,
  currency,
  masters,
  supabase,
  onClose,
  onCreated,
}: {
  open: boolean;
  tenantId: string;
  currency: string;
  masters: OrderMasters;
  supabase: DashboardSupabaseClient;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState<OrderCustomer[]>([]);
  const [customer, setCustomer] = useState<OrderCustomer | null>(null);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '' });
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()]);
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [driverNotes, setDriverNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset every field when the drawer opens — a half-built order must never
  // leak into the next one.
  useEffect(() => {
    if (!open) return;
    setCustomerQuery('');
    setCustomer(null);
    setShowNewCustomer(false);
    setNewCustomer({ name: '', phone: '' });
    setItems([emptyItem()]);
    setPaymentMethodId('');
    setPaymentReference('');
    setDeliveryAddress('');
    setDeliveryDate('');
    setDriverNotes('');
    setError(null);
    void fetchCatalogForPicker(supabase).then(setCatalog, () => setCatalog([]));
    void searchCustomers(supabase, '').then(setCustomerResults, () => setCustomerResults([]));
  }, [open, supabase]);

  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => {
      void searchCustomers(supabase, customerQuery).then(setCustomerResults, () => {});
    }, 300);
    return () => clearTimeout(handle);
  }, [customerQuery, open, supabase]);

  /** Picking a customer prefills the address they gave us (§2). */
  function onPickCustomer(picked: OrderCustomer) {
    setCustomer(picked);
    if (deliveryAddress.trim() === '' && picked.address) {
      setDeliveryAddress([picked.address, picked.city].filter(Boolean).join(', '));
    }
  }

  async function onCreateCustomer() {
    try {
      const result = await createCustomer(supabase, tenantId, {
        name: newCustomer.name.trim(),
        phone: newCustomer.phone.trim(),
        email: null,
        address: null,
        city: null,
        gender: null,
        age_group: null,
        consent_status: 'unknown',
        attributes: {},
      });
      if (result.outcome === 'duplicate') {
        setError(t('customers.drawer.duplicateTitle'));
        return;
      }
      const created = result.customer;
      onPickCustomer({
        id: created.id,
        name: created.name,
        phone: created.phone,
        wa_id: created.wa_id,
        address: created.address,
        city: created.city,
      });
      setShowNewCustomer(false);
      setError(null);
    } catch {
      setError(t('customers.validation.generic'));
    }
  }

  /** Choosing a product fills the line's description and price (§2). */
  function onPickProduct(key: string, productId: string) {
    const product = catalog.find((candidate) => candidate.id === productId);
    setItems((prev) =>
      prev.map((item) =>
        item.key === key
          ? {
              ...item,
              productId,
              description: product?.name ?? item.description,
              unitPrice: product ? String(effectivePrice(product)) : item.unitPrice,
            }
          : item,
      ),
    );
  }

  function updateItem(key: string, patch: Partial<ItemDraft>) {
    setItems((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  /** Drafts → the OrderCreate item shape; incomplete lines are dropped. */
  const parsedItems = useMemo(
    () =>
      items.flatMap((item) => {
        const qty = Number(item.qty);
        const unitPrice = parsePriceInput(item.unitPrice);
        const description = item.description.trim();
        if (
          description === '' ||
          !Number.isInteger(qty) ||
          qty <= 0 ||
          unitPrice === undefined
        ) {
          return [];
        }
        return [
          {
            product_id: item.productId === '' ? null : item.productId,
            description,
            qty,
            unit_price: unitPrice,
          },
        ];
      }),
    [items],
  );

  const total = computeOrderTotal(parsedItems);

  async function onSubmit() {
    setError(null);
    if (!customer) {
      setError(t('orders.create.customerRequired'));
      return;
    }
    if (parsedItems.length === 0) {
      setError(t('orders.create.itemsRequired'));
      return;
    }

    const payload: OrderCreate = {
      customer_id: customer.id,
      items: parsedItems,
      payment_method_id: paymentMethodId === '' ? null : paymentMethodId,
      payment_reference: paymentReference.trim() === '' ? null : paymentReference.trim(),
      delivery_address: deliveryAddress.trim() === '' ? null : deliveryAddress.trim(),
      delivery_date: deliveryDate === '' ? null : deliveryDate,
      driver_notes: driverNotes.trim() === '' ? null : driverNotes.trim(),
    };
    const parsed = OrderCreateSchema.safeParse(payload);
    if (!parsed.success) {
      setError(t('orders.create.createError'));
      return;
    }

    setSaving(true);
    try {
      await createOrder(supabase, tenantId, currency, parsed.data);
      toast.success(t('orders.create.created'));
      onCreated();
    } catch (caught) {
      setError(
        caught instanceof MissingInitialStatusError
          ? t('orders.create.noStatusConfigured')
          : t('orders.create.createError'),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{t('orders.create.title')}</SheetTitle>
          <SheetDescription>{t('orders.create.customerPlaceholder')}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 px-4 pb-6">
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-medium">{t('orders.create.customerSection')}</h3>
            {customer ? (
              <div className="flex items-center justify-between rounded-md border bg-muted/40 p-3 text-sm">
                <div>
                  <div className="font-medium">{customer.name ?? t('customers.unnamed')}</div>
                  <div className="text-muted-foreground">
                    {formatPhone(customer.phone ?? customer.wa_id)}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setCustomer(null)}>
                  {t('common.remove')}
                </Button>
              </div>
            ) : (
              <>
                <Input
                  value={customerQuery}
                  onChange={(e) => setCustomerQuery(e.target.value)}
                  placeholder={t('orders.create.customerPlaceholder')}
                />
                <div className="max-h-48 overflow-y-auto rounded-md border">
                  {customerResults.map((candidate) => (
                    <button
                      key={candidate.id}
                      type="button"
                      className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-muted/60"
                      onClick={() => onPickCustomer(candidate)}
                    >
                      <span className="font-medium">
                        {candidate.name ?? t('customers.unnamed')}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatPhone(candidate.phone ?? candidate.wa_id)}
                      </span>
                    </button>
                  ))}
                </div>
                {showNewCustomer ? (
                  <div className="flex flex-col gap-2 rounded-md border p-3">
                    <Field labelKey="customers.drawer.name">
                      <Input
                        value={newCustomer.name}
                        onChange={(e) =>
                          setNewCustomer({ ...newCustomer, name: e.target.value })
                        }
                      />
                    </Field>
                    <Field labelKey="customers.drawer.phone">
                      <Input
                        value={newCustomer.phone}
                        onChange={(e) =>
                          setNewCustomer({ ...newCustomer, phone: e.target.value })
                        }
                      />
                    </Field>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={
                          newCustomer.name.trim() === '' || newCustomer.phone.trim() === ''
                        }
                        onClick={() => void onCreateCustomer()}
                      >
                        {t('common.save')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowNewCustomer(false)}
                      >
                        {t('common.cancel')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    onClick={() => setShowNewCustomer(true)}
                  >
                    <UserPlus className="size-4" />
                    {t('orders.create.newCustomer')}
                  </Button>
                )}
              </>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-medium">{t('orders.create.itemsSection')}</h3>
            {items.map((item) => {
              const product = catalog.find((candidate) => candidate.id === item.productId);
              return (
                <div key={item.key} className="flex flex-col gap-2 rounded-md border p-3">
                  <Select
                    value={item.productId}
                    onValueChange={(value) => onPickProduct(item.key, value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t('orders.create.chooseProduct')} />
                    </SelectTrigger>
                    <SelectContent>
                      {catalog.map((candidate) => (
                        <SelectItem key={candidate.id} value={candidate.id}>
                          {candidate.name}
                          {!candidate.available && ` · ${t('products.availability.unavailable')}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {product && !product.available && (
                    // Pickable on purpose: the owner may be logging a sale of
                    // something they've stopped listing online (§2).
                    <p className="flex items-center gap-1 text-xs text-amber-700">
                      <AlertTriangle className="size-3" />
                      {t('orders.create.unavailableWarning')}
                    </p>
                  )}

                  <Input
                    value={item.description}
                    onChange={(e) => updateItem(item.key, { description: e.target.value })}
                    placeholder={t('orders.drawer.itemProduct')}
                  />

                  <div className="flex items-end gap-2">
                    <Field labelKey="orders.drawer.itemQty">
                      <Input
                        type="number"
                        min={1}
                        className="w-20"
                        value={item.qty}
                        onChange={(e) => updateItem(item.key, { qty: e.target.value })}
                      />
                    </Field>
                    <Field labelKey="orders.drawer.itemUnitPrice">
                      <Input
                        inputMode="decimal"
                        value={item.unitPrice}
                        onChange={(e) => updateItem(item.key, { unitPrice: e.target.value })}
                      />
                    </Field>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('common.remove')}
                      disabled={items.length === 1}
                      onClick={() =>
                        setItems((prev) => prev.filter((line) => line.key !== item.key))
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              );
            })}

            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => setItems((prev) => [...prev, emptyItem()])}
            >
              <Plus className="size-4" />
              {t('orders.create.addItem')}
            </Button>

            <div className="flex items-center justify-between border-t pt-2 text-sm font-medium">
              <span>{t('orders.drawer.total')}</span>
              <span className="tabular-nums">{formatMoney(total, currency)}</span>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-medium">{t('orders.create.paymentSection')}</h3>
            <Field labelKey="orders.drawer.paymentMethod">
              <Select
                value={paymentMethodId === '' ? NO_METHOD : paymentMethodId}
                onValueChange={(value) => setPaymentMethodId(value === NO_METHOD ? '' : value)}
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
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
              />
            </Field>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-medium">{t('orders.create.logisticsSection')}</h3>
            <Field labelKey="orders.drawer.deliveryAddress">
              <Textarea
                rows={2}
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
              />
            </Field>
            <Field labelKey="orders.drawer.deliveryDate">
              <Input
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
              />
            </Field>
            <Field labelKey="orders.drawer.driverNotes">
              <Textarea
                rows={2}
                value={driverNotes}
                onChange={(e) => setDriverNotes(e.target.value)}
              />
            </Field>
          </section>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2">
            <Button onClick={() => void onSubmit()} disabled={saving}>
              {saving ? t('orders.create.submitting') : t('orders.create.submit')}
            </Button>
            <Button variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
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
