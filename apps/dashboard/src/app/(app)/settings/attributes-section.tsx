'use client';

/**
 * Customer attribute defs (WS-D4 §2): the toggleable fields the configurator's
 * capture picker and the customers screen read. Two guards, per the spec:
 *   · `key` and `type` are immutable once created (referenced by
 *     `customers.attributes` and published `capture.fields`) — the edit form
 *     shows them read-only; correcting them means delete + recreate.
 *   · Disabling/deleting a def referenced by the *published* config, or deleting
 *     one that already has customer data, warns first — never silently break a
 *     live agent or drop data.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import { ATTRIBUTE_TYPES, type AttributeType } from '@optiax/shared';
import { t, type TranslationKey } from '@/i18n/index';
import type { DashboardSupabaseClient } from '@/lib/supabase/types';
import type { AttributeDefRow } from '@/lib/settings/types';
import { countCustomersWithAttribute } from '@/lib/settings/queries';
import {
  createAttributeDef,
  deleteAttributeDef,
  updateAttributeDef,
} from '@/lib/settings/mutations';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const TYPE_LABELS: Record<AttributeType, TranslationKey> = {
  text: 'settings.types.text',
  number: 'settings.types.number',
  date: 'settings.types.date',
  select: 'settings.types.select',
  boolean: 'settings.types.boolean',
};

/** `options` jsonb → string[] for the form. */
function optionsOf(def: AttributeDefRow): string[] {
  return Array.isArray(def.options) ? def.options.filter((o): o is string => typeof o === 'string') : [];
}

interface EditState {
  id: string | null; // null → creating
  key: string;
  label: string;
  type: AttributeType;
  optionsText: string;
  enabled: boolean;
}

const BLANK: EditState = { id: null, key: '', label: '', type: 'text', optionsText: '', enabled: true };

interface DeleteState {
  def: AttributeDefRow;
  inPublished: boolean;
  dataCount: number;
}

export function AttributesSection({
  tenantId,
  supabase,
  defs,
  publishedCaptureKeys,
  onChanged,
}: {
  tenantId: string;
  supabase: DashboardSupabaseClient;
  defs: AttributeDefRow[];
  publishedCaptureKeys: string[];
  onChanged: () => void;
}) {
  const published = new Set(publishedCaptureKeys);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [deleting, setDeleting] = useState<DeleteState | null>(null);
  const [disabling, setDisabling] = useState<AttributeDefRow | null>(null);
  const [saving, setSaving] = useState(false);

  function optionsFromText(text: string): string[] {
    return text
      .split('\n')
      .map((o) => o.trim())
      .filter((o) => o.length > 0);
  }

  async function onSave() {
    if (!editing) return;
    setSaving(true);
    try {
      const options = editing.type === 'select' ? optionsFromText(editing.optionsText) : null;
      if (editing.id === null) {
        await createAttributeDef(supabase, tenantId, {
          key: editing.key.trim(),
          label: editing.label.trim(),
          type: editing.type,
          options,
          enabled: editing.enabled,
        });
        toast.success(t('settings.attributes.created'));
      } else {
        await updateAttributeDef(supabase, editing.id, {
          label: editing.label.trim(),
          options,
          enabled: editing.enabled,
        });
        toast.success(t('settings.attributes.updated'));
      }
      setEditing(null);
      onChanged();
    } catch {
      toast.error(t('common.errorGeneric'));
    } finally {
      setSaving(false);
    }
  }

  /** Turning a def off: confirm first if a live agent captures it. */
  async function setEnabled(def: AttributeDefRow, enabled: boolean) {
    if (!enabled && published.has(def.key)) {
      setDisabling(def);
      return;
    }
    await applyEnabled(def, enabled);
  }

  async function applyEnabled(def: AttributeDefRow, enabled: boolean) {
    try {
      await updateAttributeDef(supabase, def.id, {
        label: def.label,
        options: optionsOf(def).length > 0 ? optionsOf(def) : null,
        enabled,
      });
      onChanged();
    } catch {
      toast.error(t('common.errorGeneric'));
    }
  }

  async function openDelete(def: AttributeDefRow) {
    let dataCount = 0;
    try {
      dataCount = await countCustomersWithAttribute(supabase, def.key);
    } catch {
      dataCount = 0;
    }
    setDeleting({ def, inPublished: published.has(def.key), dataCount });
  }

  async function onDelete() {
    if (!deleting) return;
    setSaving(true);
    try {
      await deleteAttributeDef(supabase, deleting.def.id);
      toast.success(t('settings.attributes.deleted'));
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
            <Tags className="size-4" />
            {t('settings.attributes.title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('settings.attributes.description')}</p>
        </div>
        <Button size="sm" onClick={() => setEditing({ ...BLANK })}>
          <Plus className="size-4" />
          {t('settings.attributes.add')}
        </Button>
      </div>

      {defs.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          {t('settings.attributes.empty')}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {defs.map((def) => (
            <li key={def.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <span className="truncate">{def.label}</span>
                  <code className="rounded bg-muted px-1 text-[11px] text-muted-foreground">
                    {def.key}
                  </code>
                  <span className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {t(TYPE_LABELS[def.type])}
                  </span>
                  {def.is_preset && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {t('settings.attributes.preset')}
                    </span>
                  )}
                  {published.has(def.key) && (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800">
                      <AlertTriangle className="size-3" />
                      {t('settings.attributes.inUseWarning')}
                    </span>
                  )}
                </div>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Checkbox
                  checked={def.enabled}
                  aria-label={t('settings.attributes.enabled')}
                  onCheckedChange={(v) => void setEnabled(def, v === true)}
                />
                {t('settings.attributes.enabled')}
              </label>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('common.edit')}
                onClick={() =>
                  setEditing({
                    id: def.id,
                    key: def.key,
                    label: def.label,
                    type: def.type,
                    optionsText: optionsOf(def).join('\n'),
                    enabled: def.enabled,
                  })
                }
              >
                <Pencil className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('common.delete')}
                onClick={() => void openDelete(def)}
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
              {editing?.id === null ? t('settings.attributes.add') : t('common.edit')}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="ad-key">{t('settings.attributes.key')}</Label>
                <Input
                  id="ad-key"
                  value={editing.key}
                  disabled={editing.id !== null}
                  placeholder="talla_preferida"
                  onChange={(e) => setEditing({ ...editing, key: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  {editing.id === null
                    ? t('settings.attributes.keyHint')
                    : t('settings.attributes.keyImmutable')}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ad-label">{t('settings.attributes.label')}</Label>
                <Input
                  id="ad-label"
                  value={editing.label}
                  onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('settings.attributes.type')}</Label>
                <Select
                  value={editing.type}
                  disabled={editing.id !== null}
                  onValueChange={(v) => setEditing({ ...editing, type: v as AttributeType })}
                >
                  <SelectTrigger aria-label={t('settings.attributes.type')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ATTRIBUTE_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {t(TYPE_LABELS[type])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {editing.id !== null && (
                  <p className="text-xs text-muted-foreground">
                    {t('settings.attributes.typeImmutable')}
                  </p>
                )}
              </div>
              {editing.type === 'select' && (
                <div className="space-y-1.5">
                  <Label htmlFor="ad-options">{t('settings.attributes.options')}</Label>
                  <Textarea
                    id="ad-options"
                    rows={4}
                    value={editing.optionsText}
                    onChange={(e) => setEditing({ ...editing, optionsText: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('settings.attributes.optionsHint')}
                  </p>
                </div>
              )}
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={editing.enabled}
                  onCheckedChange={(v) => setEditing({ ...editing, enabled: v === true })}
                />
                {t('settings.attributes.enabled')}
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

      {/* Disable-in-use confirm */}
      <Dialog open={disabling !== null} onOpenChange={(open) => (!open ? setDisabling(null) : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.attributes.enabled')}</DialogTitle>
            <DialogDescription>{t('settings.attributes.inUseWarning')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisabling(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const def = disabling;
                setDisabling(null);
                if (def) void applyEnabled(def, false);
              }}
            >
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm with warnings */}
      <Dialog open={deleting !== null} onOpenChange={(open) => (!open ? setDeleting(null) : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.attributes.deleteTitle')}</DialogTitle>
            <DialogDescription>
              {t('settings.attributes.deleteBody').replace('{label}', deleting?.def.label ?? '')}
            </DialogDescription>
          </DialogHeader>
          {deleting && (deleting.inPublished || deleting.dataCount > 0) && (
            <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              {deleting.inPublished && (
                <p className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  {t('settings.attributes.inUseWarning')}
                </p>
              )}
              {deleting.dataCount > 0 && (
                <p className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  {t('settings.attributes.dataWarning').replace('{count}', String(deleting.dataCount))}
                </p>
              )}
            </div>
          )}
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
