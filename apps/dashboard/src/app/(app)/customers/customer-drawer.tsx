'use client';

/**
 * Customer detail drawer (WS-D1 §3) + manual creation (§4). One form for both
 * modes; attribute inputs are driven by enabled attribute_defs. Saves are
 * optimistic from the user's perspective: the form keeps its state, errors
 * toast and nothing is lost. `source` is only ever written here as 'manual'
 * (creation) — edits never touch it.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, MessageSquare, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { CustomerCreateSchema, CustomerEditSchema, type CustomerEdit } from '@optiax/shared';
import { t, type TranslationKey } from '@/i18n/index';
import type { DashboardSupabaseClient } from '@/lib/supabase/types';
import { formatDateTime, formatMoney, formatRelative } from '@/lib/format';
import { convertAttributeValue } from '@/lib/customers/attribute-convert';
import { fetchConversationId, fetchCustomerById } from '@/lib/customers/list';
import {
  addTagToCustomer,
  createCustomer,
  createTag,
  removeTagFromCustomer,
  updateCustomer,
  TAG_COLORS,
  type PhoneIndexEntry,
} from '@/lib/customers/mutations';
import { selectOptions, type AttributeDefRow, type CustomerListItem, type TagRow } from '@/lib/customers/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { ConsentBadge, TagBadge } from './badges';

export type DrawerState = { mode: 'edit'; item: CustomerListItem } | { mode: 'create' };

const CONSENT_VALUES = ['unknown', 'opted_in', 'opted_out'] as const;

interface FormState {
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  gender: string;
  age_group: string;
  consent: (typeof CONSENT_VALUES)[number];
  /** raw string per attribute def key */
  attrs: Record<string, string>;
}

function emptyForm(): FormState {
  return {
    name: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    gender: '',
    age_group: '',
    consent: 'unknown',
    attrs: {},
  };
}

function formFromItem(item: CustomerListItem, defs: AttributeDefRow[]): FormState {
  const attrs: Record<string, string> = {};
  const attributes =
    typeof item.customer.attributes === 'object' && item.customer.attributes !== null
      ? (item.customer.attributes as Record<string, unknown>)
      : {};
  for (const def of defs) {
    const value = attributes[def.key];
    if (value === undefined || value === null) continue;
    attrs[def.key] = String(value);
  }
  return {
    name: item.customer.name ?? '',
    phone: item.customer.phone ?? '',
    email: item.customer.email ?? '',
    address: item.customer.address ?? '',
    city: item.customer.city ?? '',
    gender: item.customer.gender ?? '',
    age_group: item.customer.age_group ?? '',
    consent: item.customer.consent_status,
    attrs,
  };
}

export function CustomerDrawer({
  state,
  tenantId,
  currency,
  defs,
  tags,
  supabase,
  onClose,
  onOpenCustomer,
  onChanged,
}: {
  state: DrawerState | null;
  tenantId: string;
  currency: string;
  defs: AttributeDefRow[];
  tags: TagRow[];
  supabase: DashboardSupabaseClient;
  onClose: () => void;
  onOpenCustomer: (item: CustomerListItem) => void;
  onChanged: () => void;
}) {
  const [form, setForm] = useState<FormState>(emptyForm());
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [duplicate, setDuplicate] = useState<PhoneIndexEntry | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [itemTags, setItemTags] = useState<TagRow[]>([]);
  const [localTags, setLocalTags] = useState<TagRow[]>(tags);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState<string>(TAG_COLORS[0]);

  useEffect(() => setLocalTags(tags), [tags]);

  const item = state?.mode === 'edit' ? state.item : null;

  useEffect(() => {
    setFieldErrors({});
    setDuplicate(null);
    setConversationId(null);
    if (!state) return;
    if (state.mode === 'edit') {
      setForm(formFromItem(state.item, defs));
      setItemTags(state.item.tags);
      void fetchConversationId(supabase, state.item.customer.id).then(setConversationId, () => {});
    } else {
      setForm(emptyForm());
      setItemTags([]);
    }
  }, [state, defs, supabase]);

  const errorKeyFor = (issuePath: string): TranslationKey => {
    const map: Record<string, TranslationKey> = {
      name: 'customers.validation.name',
      phone: 'customers.validation.phone',
      email: 'customers.validation.email',
      address: 'customers.validation.address',
      city: 'customers.validation.city',
      gender: 'customers.validation.gender',
      age_group: 'customers.validation.age_group',
      consent_status: 'customers.validation.consent_status',
      attributes: 'customers.validation.attributes',
    };
    return map[issuePath] ?? 'customers.validation.generic';
  };

  /** Build the CustomerEdit payload from form state; null on attr conversion error. */
  function buildEdit(): { edit: CustomerEdit; errors: Record<string, string> } {
    const errors: Record<string, string> = {};
    const existingAttributes =
      item && typeof item.customer.attributes === 'object' && item.customer.attributes !== null
        ? { ...(item.customer.attributes as Record<string, unknown>) }
        : {};

    // Only def-governed keys are written; unknown keys (agent-captured) are preserved.
    const attributes: Record<string, unknown> = { ...existingAttributes };
    for (const def of defs) {
      const raw = form.attrs[def.key] ?? '';
      const converted = convertAttributeValue(def, raw);
      if (!converted.ok) {
        errors[`attr.${def.key}`] = t('customers.validation.attributes');
        continue;
      }
      if (converted.value === undefined) delete attributes[def.key];
      else attributes[def.key] = converted.value;
    }

    const trimmedOrNull = (value: string) => {
      const trimmed = value.trim();
      return trimmed === '' ? null : trimmed;
    };

    const edit = {
      name: trimmedOrNull(form.name),
      phone: trimmedOrNull(form.phone),
      email: trimmedOrNull(form.email),
      address: trimmedOrNull(form.address),
      city: trimmedOrNull(form.city),
      gender: trimmedOrNull(form.gender),
      age_group: trimmedOrNull(form.age_group),
      consent_status: form.consent,
      attributes,
    } as CustomerEdit;
    return { edit, errors };
  }

  function collectZodErrors(error: z.ZodError): Record<string, string> {
    const errors: Record<string, string> = {};
    for (const issue of error.issues) {
      const field = String(issue.path[0] ?? '');
      errors[field] = t(errorKeyFor(field));
    }
    return errors;
  }

  async function onSave() {
    if (!state) return;
    const { edit, errors } = buildEdit();
    const schema = state.mode === 'create' ? CustomerCreateSchema : CustomerEditSchema;
    const parsed = schema.safeParse(edit);
    if (!parsed.success || Object.keys(errors).length > 0) {
      setFieldErrors({
        ...(parsed.success ? {} : collectZodErrors(parsed.error)),
        ...errors,
      });
      return;
    }
    setFieldErrors({});
    setSaving(true);
    try {
      if (state.mode === 'edit') {
        await updateCustomer(supabase, state.item.customer.id, parsed.data);
        toast.success(t('customers.drawer.saved'));
        onChanged();
      } else {
        const result = await createCustomer(
          supabase,
          tenantId,
          parsed.data as z.infer<typeof CustomerCreateSchema>,
        );
        if (result.outcome === 'duplicate') {
          setDuplicate(result.existing);
        } else {
          toast.success(t('customers.drawer.created'));
          onChanged();
          onOpenCustomer({ customer: result.customer, tags: [] });
        }
      }
    } catch {
      toast.error(
        state.mode === 'edit' ? t('customers.drawer.saveError') : t('common.errorGeneric'),
      );
    } finally {
      setSaving(false);
    }
  }

  async function onOpenDuplicate() {
    if (!duplicate) return;
    try {
      const existing = await fetchCustomerById(supabase, duplicate.id);
      if (existing) onOpenCustomer({ customer: existing.customer, tags: existing.tags });
    } catch {
      toast.error(t('common.errorGeneric'));
    }
  }

  async function onAddTag(tag: TagRow) {
    if (!item) return;
    setItemTags((prev) => (prev.some((existing) => existing.id === tag.id) ? prev : [...prev, tag]));
    try {
      await addTagToCustomer(supabase, tenantId, item.customer.id, tag.id);
      onChanged();
    } catch {
      setItemTags((prev) => prev.filter((existing) => existing.id !== tag.id));
      toast.error(t('common.errorGeneric'));
    }
  }

  async function onRemoveTag(tag: TagRow) {
    if (!item) return;
    const before = itemTags;
    setItemTags((prev) => prev.filter((existing) => existing.id !== tag.id));
    try {
      await removeTagFromCustomer(supabase, item.customer.id, tag.id);
      onChanged();
    } catch {
      setItemTags(before);
      toast.error(t('common.errorGeneric'));
    }
  }

  async function onCreateTag() {
    const name = newTagName.trim();
    if (!name || !item) return;
    try {
      const tag = await createTag(supabase, tenantId, name, newTagColor);
      setLocalTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
      setNewTagName('');
      await onAddTag(tag);
    } catch {
      toast.error(t('common.errorGeneric'));
    }
  }

  const availableTags = useMemo(
    () => localTags.filter((tag) => !itemTags.some((existing) => existing.id === tag.id)),
    [localTags, itemTags],
  );

  const waId = item?.customer.wa_id ?? null;

  return (
    <Sheet open={state !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>
            {state?.mode === 'create'
              ? t('customers.drawer.createTitle')
              : t('customers.drawer.editTitle')}
          </SheetTitle>
          <SheetDescription>
            {state?.mode === 'create' ? t('customers.drawer.requiredHint') : null}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 px-4 pb-6">
          {item && (
            <div className="flex flex-wrap gap-2">
              {conversationId && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/inbox?conversation=${conversationId}`}>
                    <MessageSquare className="size-4" />
                    {t('customers.drawer.viewConversation')}
                  </Link>
                </Button>
              )}
              {waId && (
                <Button variant="outline" size="sm" asChild>
                  <a href={`https://wa.me/${waId}`} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="size-4" />
                    {t('customers.drawer.openWhatsapp')}
                  </a>
                </Button>
              )}
            </div>
          )}

          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-medium">{t('customers.drawer.coreSection')}</h3>
            <Field labelKey="customers.drawer.name" error={fieldErrors['name']}>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field labelKey="customers.drawer.phone" error={fieldErrors['phone']}>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </Field>
            <Field labelKey="customers.drawer.email" error={fieldErrors['email']}>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field labelKey="customers.drawer.address" error={fieldErrors['address']}>
              <Input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field labelKey="customers.drawer.city" error={fieldErrors['city']}>
                <Input
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                />
              </Field>
              <Field labelKey="customers.drawer.gender" error={fieldErrors['gender']}>
                <Input
                  value={form.gender}
                  onChange={(e) => setForm({ ...form, gender: e.target.value })}
                />
              </Field>
            </div>
            <Field labelKey="customers.drawer.ageGroup" error={fieldErrors['age_group']}>
              <Input
                value={form.age_group}
                onChange={(e) => setForm({ ...form, age_group: e.target.value })}
                placeholder="25-34"
              />
            </Field>
            <Field labelKey="customers.drawer.consent" error={fieldErrors['consent_status']}>
              <Select
                value={form.consent}
                onValueChange={(value) =>
                  setForm({ ...form, consent: value as FormState['consent'] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONSENT_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`customers.consent.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t('customers.drawer.consentHint')}</p>
            </Field>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-medium">{t('customers.drawer.attributesSection')}</h3>
            {defs.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('customers.drawer.attributesEmpty')}</p>
            )}
            {defs.map((def) => (
              <AttributeInput
                key={def.id}
                def={def}
                value={form.attrs[def.key] ?? ''}
                error={fieldErrors[`attr.${def.key}`]}
                onChange={(value) =>
                  setForm({ ...form, attrs: { ...form.attrs, [def.key]: value } })
                }
              />
            ))}
          </section>

          {item && (
            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">{t('customers.drawer.tagsSection')}</h3>
              <div className="flex flex-wrap gap-1.5">
                {itemTags.map((tag) => (
                  <TagBadge key={tag.id} tag={tag} onRemove={() => void onRemoveTag(tag)} />
                ))}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-6 gap-1 px-2 text-xs">
                      <Plus className="size-3" />
                      {t('customers.drawer.addTag')}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-60">
                    {availableTags.map((tag) => (
                      <DropdownMenuItem key={tag.id} onSelect={() => void onAddTag(tag)}>
                        <span
                          className="size-2.5 rounded-full"
                          style={{ backgroundColor: tag.color }}
                        />
                        {tag.name}
                      </DropdownMenuItem>
                    ))}
                    {availableTags.length > 0 && <DropdownMenuSeparator />}
                    <div
                      className="flex flex-col gap-2 p-2"
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <Input
                        value={newTagName}
                        onChange={(e) => setNewTagName(e.target.value)}
                        placeholder={t('customers.drawer.newTagPlaceholder')}
                        className="h-8"
                      />
                      <div className="flex items-center gap-1.5">
                        {TAG_COLORS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            aria-label={color}
                            className="size-5 rounded-full border"
                            style={{
                              backgroundColor: color,
                              outline: newTagColor === color ? `2px solid ${color}` : 'none',
                              outlineOffset: 2,
                            }}
                            onClick={() => setNewTagColor(color)}
                          />
                        ))}
                      </div>
                      <Button
                        size="sm"
                        disabled={newTagName.trim() === ''}
                        onClick={() => void onCreateTag()}
                      >
                        {t('customers.drawer.createTag')}
                      </Button>
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </section>
          )}

          {item && (
            <section className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3 text-sm">
              <h3 className="text-sm font-medium">{t('customers.drawer.readOnlySection')}</h3>
              <ReadOnlyRow label={t('customers.drawer.totalSpent')}>
                {formatMoney(item.customer.total_spent, currency)}
              </ReadOnlyRow>
              <ReadOnlyRow label={t('customers.drawer.lastOrder')}>
                {formatRelative(item.customer.last_order_at)}
              </ReadOnlyRow>
              <ReadOnlyRow label={t('customers.drawer.lastMessage')}>
                {formatRelative(item.customer.last_message_at)}
              </ReadOnlyRow>
              <ReadOnlyRow label={t('customers.drawer.source')}>
                <Badge variant="outline">{t(`customers.source.${item.customer.source}`)}</Badge>
              </ReadOnlyRow>
              <ReadOnlyRow label={t('customers.drawer.createdAt')}>
                {formatDateTime(item.customer.created_at)}
              </ReadOnlyRow>
              <ReadOnlyRow label={t('customers.drawer.consent')}>
                <ConsentBadge status={item.customer.consent_status} />
              </ReadOnlyRow>
            </section>
          )}

          {duplicate && (
            <div className="flex flex-col gap-2 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm">
              <p className="font-medium text-amber-800">{t('customers.drawer.duplicateTitle')}</p>
              <p className="text-amber-800">
                {duplicate.name ?? t('customers.unnamed')} · {duplicate.digits}
              </p>
              <Button variant="outline" size="sm" onClick={() => void onOpenDuplicate()}>
                {t('customers.drawer.duplicateView')}
              </Button>
            </div>
          )}

          <div className="flex gap-2">
            <Button onClick={() => void onSave()} disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
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
  error,
  children,
}: {
  labelKey: TranslationKey;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">{t(labelKey)}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function AttributeInput({
  def,
  value,
  error,
  onChange,
}: {
  def: AttributeDefRow;
  value: string;
  error?: string | undefined;
  onChange: (value: string) => void;
}) {
  const NONE = '__none__';
  let control: React.ReactNode;
  switch (def.type) {
    case 'select':
      control = (
        <Select
          value={value === '' ? NONE : value}
          onValueChange={(v) => onChange(v === NONE ? '' : v)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t('common.none')}</SelectItem>
            {selectOptions(def).map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    case 'boolean':
      control = (
        <div className="flex items-center gap-2">
          <Checkbox
            checked={value === 'true'}
            onCheckedChange={(checked) => onChange(checked === true ? 'true' : 'false')}
          />
          <span className="text-sm text-muted-foreground">
            {value === 'true' ? t('common.yes') : t('common.no')}
          </span>
        </div>
      );
      break;
    case 'number':
      control = <Input type="number" value={value} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'date':
      control = <Input type="date" value={value} onChange={(e) => onChange(e.target.value)} />;
      break;
    default:
      control = <Input value={value} onChange={(e) => onChange(e.target.value)} />;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">{def.label}</Label>
      {control}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function ReadOnlyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span>{children}</span>
    </div>
  );
}
