'use client';

/**
 * Product create/edit drawer (WS-D2 §1). One form for both modes, mirroring
 * the customers drawer.
 *
 * Images only appear once the product exists: their Storage path contains the
 * product id, and uploading before the row is saved would strand blobs under a
 * key nothing references. Creating therefore reopens the drawer in edit mode.
 */
import { useEffect, useState } from 'react';
import { ImageOff, Plus, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { PRODUCT_MAX_IMAGES, ProductSchema, type Product } from '@optiax/shared';
import { t, type TranslationKey } from '@/i18n/index';
import type { DashboardSupabaseClient } from '@/lib/supabase/types';
import { formatDateTime } from '@/lib/format';
import { signMediaPath } from '@/lib/media';
import { removeMediaObject, uploadProductImage } from '@/lib/products/images';
import { parsePriceInput } from '@/lib/products/price-input';
import {
  createProduct,
  createProductCategory,
  deleteProduct,
  setProductAvailability,
  setProductImages,
  updateProduct,
} from '@/lib/products/mutations';
import type { ProductCategoryRow, ProductListItem } from '@/lib/products/types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

export type ProductDrawerState = { mode: 'edit'; item: ProductListItem } | { mode: 'create' };

const NO_CATEGORY = '__none__';

interface FormState {
  name: string;
  description: string;
  categoryId: string;
  price: string;
  promoPrice: string;
  available: boolean;
}

/** A stored image plus the signed URL it currently renders from. */
interface DrawerImage {
  path: string;
  url: string | null;
}

function emptyForm(): FormState {
  return {
    name: '',
    description: '',
    categoryId: '',
    price: '',
    promoPrice: '',
    available: true,
  };
}

function formFromItem(item: ProductListItem): FormState {
  const { product } = item;
  return {
    name: product.name,
    description: product.description ?? '',
    categoryId: product.category_id ?? '',
    price: String(product.price),
    promoPrice: product.promo_price === null ? '' : String(product.promo_price),
    available: product.available,
  };
}

function imagesFromItem(item: ProductListItem): DrawerImage[] {
  return item.product.image_paths.map((path, index) => ({
    path,
    url: item.imageUrls[index] ?? null,
  }));
}

export function ProductDrawer({
  state,
  tenantId,
  currency,
  categories,
  supabase,
  onClose,
  onOpenProduct,
  onChanged,
}: {
  state: ProductDrawerState | null;
  tenantId: string;
  currency: string;
  categories: ProductCategoryRow[];
  supabase: DashboardSupabaseClient;
  onClose: () => void;
  onOpenProduct: (item: ProductListItem) => void;
  onChanged: () => void;
}) {
  const [form, setForm] = useState<FormState>(emptyForm());
  const [images, setImages] = useState<DrawerImage[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [localCategories, setLocalCategories] = useState<ProductCategoryRow[]>(categories);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBlocked, setDeleteBlocked] = useState(false);

  useEffect(() => setLocalCategories(categories), [categories]);

  const item = state?.mode === 'edit' ? state.item : null;

  useEffect(() => {
    setFieldErrors({});
    setNewCategoryName('');
    setConfirmDelete(false);
    setDeleteBlocked(false);
    if (!state) return;
    if (state.mode === 'edit') {
      setForm(formFromItem(state.item));
      setImages(imagesFromItem(state.item));
    } else {
      setForm(emptyForm());
      setImages([]);
    }
  }, [state]);

  const errorKeyFor = (issuePath: string): TranslationKey => {
    const map: Record<string, TranslationKey> = {
      name: 'products.validation.name',
      description: 'products.validation.description',
      price: 'products.validation.price',
      promo_price: 'products.validation.promo_price',
      category_id: 'products.validation.category_id',
      image_paths: 'products.validation.image_paths',
    };
    return map[issuePath] ?? 'products.validation.generic';
  };

  /** Form state → the Product shape, with per-field parse errors collected. */
  function buildProduct(): { product: Product; errors: Record<string, string> } {
    const errors: Record<string, string> = {};

    const price = parsePriceInput(form.price);
    if (price === undefined) errors['price'] = t('products.validation.price');

    const promoRaw = form.promoPrice.trim();
    let promoPrice: number | null = null;
    if (promoRaw !== '') {
      const parsed = parsePriceInput(promoRaw);
      if (parsed === undefined) errors['promo_price'] = t('products.validation.promo_price');
      else promoPrice = parsed;
    }

    const description = form.description.trim();
    const product = {
      name: form.name.trim(),
      description: description === '' ? null : description,
      category_id: form.categoryId === '' ? null : form.categoryId,
      price: price ?? 0,
      promo_price: promoPrice,
      available: form.available,
      image_paths: images.map((image) => image.path),
    } as Product;
    return { product, errors };
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
    const { product, errors } = buildProduct();
    const parsed = ProductSchema.safeParse(product);
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
        const saved = await updateProduct(supabase, state.item.product.id, parsed.data);
        toast.success(t('products.drawer.saved'));
        onChanged();
        onOpenProduct({ product: saved, imageUrls: urlsOf(images) });
      } else {
        const created = await createProduct(supabase, tenantId, parsed.data);
        toast.success(t('products.drawer.created'));
        onChanged();
        // Reopen in edit mode so the photo section becomes usable.
        onOpenProduct({ product: created, imageUrls: [] });
      }
    } catch {
      toast.error(t('products.drawer.saveError'));
    } finally {
      setSaving(false);
    }
  }

  async function onCreateCategory() {
    const name = newCategoryName.trim();
    if (name === '') return;
    try {
      const category = await createProductCategory(supabase, tenantId, name);
      setLocalCategories((prev) =>
        [...prev, category].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setForm((prev) => ({ ...prev, categoryId: category.id }));
      setNewCategoryName('');
      onChanged();
    } catch {
      toast.error(t('common.errorGeneric'));
    }
  }

  async function onPickImage(file: File | undefined) {
    if (!file || !item) return;
    if (!file.type.startsWith('image/')) {
      toast.error(t('products.images.notAnImage'));
      return;
    }
    if (images.length >= PRODUCT_MAX_IMAGES) {
      toast.error(t('products.images.tooMany'));
      return;
    }
    setUploading(true);
    try {
      const path = await uploadProductImage(supabase, tenantId, item.product.id, file);
      const url = await signMediaPath(supabase, path);
      const next = [...images, { path, url }];
      setImages(next);
      // Persist immediately: the blob is already in Storage, so leaving the
      // row's image_paths behind would strand it if the drawer is closed.
      await setProductImages(
        supabase,
        item.product.id,
        next.map((image) => image.path),
      );
      onChanged();
    } catch {
      toast.error(t('products.images.uploadError'));
    } finally {
      setUploading(false);
    }
  }

  async function onRemoveImage(image: DrawerImage) {
    if (!item) return;
    const next = images.filter((existing) => existing.path !== image.path);
    setImages(next);
    try {
      await setProductImages(
        supabase,
        item.product.id,
        next.map((existing) => existing.path),
      );
      await removeMediaObject(supabase, image.path);
      onChanged();
    } catch {
      setImages(images);
      toast.error(t('common.errorGeneric'));
    }
  }

  async function onConfirmDelete() {
    if (!item) return;
    setSaving(true);
    try {
      const result = await deleteProduct(supabase, item.product.id);
      if (result.outcome === 'referenced') {
        setConfirmDelete(false);
        setDeleteBlocked(true);
      } else {
        toast.success(t('products.delete.deleted'));
        setConfirmDelete(false);
        onChanged();
        onClose();
      }
    } catch {
      toast.error(t('common.errorGeneric'));
    } finally {
      setSaving(false);
    }
  }

  /** The offered alternative when the FK refuses a delete (§1). */
  async function onMarkUnavailable() {
    if (!item) return;
    try {
      await setProductAvailability(supabase, item.product.id, false);
      setForm((prev) => ({ ...prev, available: false }));
      setDeleteBlocked(false);
      toast.success(t('products.delete.markedUnavailable'));
      onChanged();
    } catch {
      toast.error(t('common.errorGeneric'));
    }
  }

  return (
    <>
      <Sheet open={state !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>
              {state?.mode === 'create'
                ? t('products.drawer.createTitle')
                : t('products.drawer.editTitle')}
            </SheetTitle>
            <SheetDescription>
              {state?.mode === 'create' ? t('products.drawer.requiredHint') : null}
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-6 px-4 pb-6">
            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">{t('products.drawer.detailsSection')}</h3>

              <Field labelKey="products.drawer.name" error={fieldErrors['name']}>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>

              <Field labelKey="products.drawer.description" error={fieldErrors['description']}>
                <Textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </Field>

              <Field labelKey="products.drawer.category" error={fieldErrors['category_id']}>
                <Select
                  value={form.categoryId === '' ? NO_CATEGORY : form.categoryId}
                  onValueChange={(value) =>
                    setForm({ ...form, categoryId: value === NO_CATEGORY ? '' : value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CATEGORY}>{t('products.noCategory')}</SelectItem>
                    {localCategories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex gap-2">
                  <Input
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    placeholder={t('products.drawer.newCategoryPlaceholder')}
                    className="h-8"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={newCategoryName.trim() === ''}
                    onClick={() => void onCreateCategory()}
                  >
                    <Plus className="size-3" />
                    {t('products.drawer.createCategory')}
                  </Button>
                </div>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field labelKey="products.drawer.price" error={fieldErrors['price']}>
                  <Input
                    inputMode="decimal"
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                    placeholder={currency}
                  />
                </Field>
                <Field labelKey="products.drawer.promoPrice" error={fieldErrors['promo_price']}>
                  <Input
                    inputMode="decimal"
                    value={form.promoPrice}
                    onChange={(e) => setForm({ ...form, promoPrice: e.target.value })}
                    placeholder={currency}
                  />
                </Field>
              </div>
              <p className="text-xs text-muted-foreground">{t('products.drawer.promoHint')}</p>

              <div className="flex items-center gap-2">
                <Checkbox
                  checked={form.available}
                  onCheckedChange={(checked) => setForm({ ...form, available: checked === true })}
                />
                <span className="text-sm">{t('products.drawer.available')}</span>
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">{t('products.images.section')}</h3>
              {!item ? (
                <p className="text-sm text-muted-foreground">{t('products.images.saveFirst')}</p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">{t('products.images.hint')}</p>
                  <div className="flex flex-wrap gap-3">
                    {images.map((image) => (
                      <div key={image.path} className="relative">
                        {image.url ? (
                          // Plain <img> on a signed Storage URL — see the
                          // rationale in product-table.tsx.
                          <img
                            src={image.url}
                            alt={form.name}
                            className="size-28 rounded-md border object-cover"
                          />
                        ) : (
                          <div className="flex size-28 flex-col items-center justify-center gap-1 rounded-md border bg-muted text-xs text-muted-foreground">
                            <ImageOff className="size-4" />
                            {t('products.images.missing')}
                          </div>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={t('products.images.remove')}
                          className="absolute top-1 right-1 size-7 p-0"
                          onClick={() => void onRemoveImage(image)}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    ))}
                    {images.length < PRODUCT_MAX_IMAGES && (
                      <label className="flex size-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed text-xs text-muted-foreground hover:bg-muted/50">
                        <Upload className="size-4" />
                        {uploading ? t('products.images.uploading') : t('products.images.add')}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={uploading}
                          onChange={(e) => {
                            void onPickImage(e.target.files?.[0]);
                            e.target.value = '';
                          }}
                        />
                      </label>
                    )}
                  </div>
                </>
              )}
            </section>

            {item && (
              <section className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3 text-sm">
                <ReadOnlyRow label={t('products.drawer.createdAt')}>
                  {formatDateTime(item.product.created_at)}
                </ReadOnlyRow>
                <ReadOnlyRow label={t('products.drawer.updatedAt')}>
                  {formatDateTime(item.product.updated_at)}
                </ReadOnlyRow>
              </section>
            )}

            {deleteBlocked && (
              <div className="flex flex-col gap-2 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm">
                <p className="font-medium text-amber-800">
                  {t('products.delete.referencedTitle')}
                </p>
                <p className="text-amber-800">{t('products.delete.referencedBody')}</p>
                <Button variant="outline" size="sm" onClick={() => void onMarkUnavailable()}>
                  {t('products.delete.markUnavailable')}
                </Button>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void onSave()} disabled={saving}>
                {saving ? t('common.saving') : t('common.save')}
              </Button>
              <Button variant="outline" onClick={onClose}>
                {t('common.cancel')}
              </Button>
              {item && (
                <Button
                  variant="ghost"
                  className="ml-auto text-destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="size-4" />
                  {t('products.delete.action')}
                </Button>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('products.delete.confirmTitle')}</DialogTitle>
            <DialogDescription>{t('products.delete.confirmBody')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={saving}
              onClick={() => void onConfirmDelete()}
            >
              {saving ? t('common.deleting') : t('products.delete.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function urlsOf(images: DrawerImage[]): string[] {
  return images.map((image) => image.url).filter((url): url is string => url !== null);
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

function ReadOnlyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span>{children}</span>
    </div>
  );
}
