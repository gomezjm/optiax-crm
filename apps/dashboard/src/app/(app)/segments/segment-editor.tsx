'use client';

/**
 * Segment editor (ws-c1 §2): a name, a type-driven rule builder, and a live
 * preview. The operator menu and value widget for each row are derived from the
 * chosen field's type (`rule-model`), so the builder can only ever emit valid
 * `SegmentRules`. The preview runs the shared engine through the anon-key + RLS
 * client, debounced, so the owner sees who they're targeting before saving.
 */
import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  SegmentRulesSchema,
  validateSegmentRules,
  type SegmentCondition,
  type SegmentField,
  type SegmentOp,
  type SegmentRules,
} from '@optiax/shared';
import { t } from '@/i18n/index';
import type { DashboardSupabaseClient } from '@/lib/supabase/types';
import type { AttributeDefRow, CustomerListItem, TagRow } from '@/lib/customers/types';
import { attributeTypeMap } from '@/lib/segments/queries';
import { evalSegmentMembers, SEGMENT_PREVIEW_LIMIT } from '@/lib/segments/executor';
import { createSegment, updateSegment } from '@/lib/segments/mutations';
import {
  defaultOperatorFor,
  defaultValueFor,
  fieldOptions,
  operatorsForField,
  valueInputFor,
} from '@/lib/segments/rule-model';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MemberTable } from './member-table';

/** One editor row — value is always held as a string, coerced when building rules. */
interface RowState {
  field: SegmentField;
  op: SegmentOp;
  value: string;
}

type Preview =
  | { state: 'invalid' }
  | { state: 'loading' }
  | { state: 'ok'; items: CustomerListItem[]; total: number };

function rowsFromRules(rules: SegmentRules): RowState[] {
  return rules.conditions.map((c) => ({
    field: c.field,
    op: c.op,
    value: c.value === undefined ? '' : String(c.value),
  }));
}

function firstRow(defs: AttributeDefRow[]): RowState {
  const field = fieldOptions(defs)[0]?.value ?? 'total_spent';
  const op = defaultOperatorFor(field, defs);
  return { field, op, value: String(defaultValueFor(field, op, defs) ?? '') };
}

/** Build a rules candidate from the form, or null if a value is missing/invalid. */
function buildRules(
  combinator: 'and' | 'or',
  rows: RowState[],
  defs: AttributeDefRow[],
): SegmentRules | null {
  const conditions: SegmentCondition[] = [];
  for (const row of rows) {
    const input = valueInputFor(row.field, row.op, defs);
    if (input.kind === 'none') {
      conditions.push({ field: row.field, op: row.op });
      continue;
    }
    let value: string | number = row.value;
    if (input.kind === 'number' || input.kind === 'days') {
      if (row.value.trim() === '' || !Number.isFinite(Number(row.value))) return null;
      value = Number(row.value);
    } else if (row.value === '') {
      return null;
    }
    conditions.push({ field: row.field, op: row.op, value });
  }
  const parsed = SegmentRulesSchema.safeParse({ combinator, conditions });
  return parsed.success ? parsed.data : null;
}

export function SegmentEditor({
  open,
  mode,
  segmentId,
  initialName,
  initialRules,
  tenantId,
  timeZone,
  currency,
  defs,
  tags,
  supabase,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: 'create' | 'edit';
  segmentId: string | null;
  initialName: string;
  initialRules: SegmentRules | null;
  tenantId: string;
  timeZone: string;
  currency: string;
  defs: AttributeDefRow[];
  tags: TagRow[];
  supabase: DashboardSupabaseClient;
  onClose: () => void;
  onSaved: () => void;
}) {
  const options = useMemo(() => fieldOptions(defs), [defs]);
  const ctx = useMemo(
    () => ({ timeZone, attributeTypes: attributeTypeMap(defs) }),
    [timeZone, defs],
  );

  const [name, setName] = useState(initialName);
  const [combinator, setCombinator] = useState<'and' | 'or'>(initialRules?.combinator ?? 'and');
  const [rows, setRows] = useState<RowState[]>(
    initialRules ? rowsFromRules(initialRules) : [firstRow(defs)],
  );
  const [preview, setPreview] = useState<Preview>({ state: 'invalid' });
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState(false);

  // Re-seed the form whenever a fresh target opens.
  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setCombinator(initialRules?.combinator ?? 'and');
    setRows(initialRules ? rowsFromRules(initialRules) : [firstRow(defs)]);
    setNameError(false);
  }, [open, segmentId]);

  const rulesSig = JSON.stringify({ combinator, rows });

  // Live, debounced preview through the engine.
  useEffect(() => {
    if (!open) return;
    const rules = buildRules(combinator, rows, defs);
    if (!rules || validateSegmentRules(rules, ctx).length > 0) {
      setPreview({ state: 'invalid' });
      return;
    }
    setPreview({ state: 'loading' });
    let cancelled = false;
    const timer = setTimeout(() => {
      evalSegmentMembers(supabase, rules, ctx, SEGMENT_PREVIEW_LIMIT)
        .then((res) => {
          if (!cancelled) setPreview({ state: 'ok', items: res.items, total: res.total });
        })
        .catch(() => {
          if (!cancelled) setPreview({ state: 'invalid' });
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [rulesSig, open]);

  function updateRow(index: number, next: Partial<RowState>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...next } : row)));
  }

  function onFieldChange(index: number, field: SegmentField) {
    const op = defaultOperatorFor(field, defs);
    updateRow(index, { field, op, value: String(defaultValueFor(field, op, defs) ?? '') });
  }

  function onOpChange(index: number, op: SegmentOp) {
    const row = rows[index];
    if (!row) return;
    const before = valueInputFor(row.field, row.op, defs).kind;
    const after = valueInputFor(row.field, op, defs).kind;
    // Only reset the value when the widget kind actually changes.
    const value = before === after ? row.value : String(defaultValueFor(row.field, op, defs) ?? '');
    updateRow(index, { op, value });
  }

  async function onSave() {
    if (!name.trim()) {
      setNameError(true);
      return;
    }
    const rules = buildRules(combinator, rows, defs);
    if (!rules) return;
    setSaving(true);
    try {
      if (mode === 'edit' && segmentId) {
        await updateSegment(supabase, segmentId, { name, rules });
        toast.success(t('segments.toast.updated'));
      } else {
        await createSegment(supabase, tenantId, { name, rules });
        toast.success(t('segments.toast.created'));
      }
      onSaved();
    } catch {
      toast.error(t('segments.toast.error'));
    } finally {
      setSaving(false);
    }
  }

  const canSave = !saving && buildRules(combinator, rows, defs) !== null && name.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === 'edit' ? t('segments.editor.editTitle') : t('segments.editor.createTitle')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="seg-name">{t('segments.editor.nameLabel')}</Label>
            <Input
              id="seg-name"
              value={name}
              placeholder={t('segments.editor.namePlaceholder')}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) setNameError(false);
              }}
            />
            {nameError && (
              <p className="text-xs text-destructive">{t('segments.editor.nameRequired')}</p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label className="text-sm">{t('segments.editor.combinatorLabel')}</Label>
              <Select value={combinator} onValueChange={(v) => setCombinator(v as 'and' | 'or')}>
                <SelectTrigger size="sm" className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="and">{t('segments.editor.combinatorAnd')}</SelectItem>
                  <SelectItem value="or">{t('segments.editor.combinatorOr')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              {rows.map((row, index) => (
                <RuleRow
                  key={index}
                  row={row}
                  options={options}
                  defs={defs}
                  tags={tags}
                  canRemove={rows.length > 1}
                  onField={(field) => onFieldChange(index, field)}
                  onOp={(op) => onOpChange(index, op)}
                  onValue={(value) => updateRow(index, { value })}
                  onRemove={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                />
              ))}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRows((prev) => [...prev, firstRow(defs)])}
            >
              <Plus className="size-4" />
              {t('segments.editor.addCondition')}
            </Button>
          </div>

          <PreviewPanel preview={preview} currency={currency} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void onSave()} disabled={!canSave}>
            {saving ? t('common.saving') : t('segments.editor.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RuleRow({
  row,
  options,
  defs,
  tags,
  canRemove,
  onField,
  onOp,
  onValue,
  onRemove,
}: {
  row: RowState;
  options: { value: SegmentField; label: string }[];
  defs: AttributeDefRow[];
  tags: TagRow[];
  canRemove: boolean;
  onField: (field: SegmentField) => void;
  onOp: (op: SegmentOp) => void;
  onValue: (value: string) => void;
  onRemove: () => void;
}) {
  const ops = operatorsForField(row.field, defs);
  const input = valueInputFor(row.field, row.op, defs);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2">
      <Select value={row.field} onValueChange={(v) => onField(v as SegmentField)}>
        <SelectTrigger size="sm" className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={row.op} onValueChange={(v) => onOp(v as SegmentOp)}>
        <SelectTrigger size="sm" className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ops.map((op) => (
            <SelectItem key={op} value={op}>
              {t(`segments.ops.${op}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <ValueField input={input} value={row.value} tags={tags} onValue={onValue} />

      {canRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ml-auto size-8 text-muted-foreground"
          aria-label={t('segments.editor.removeCondition')}
          onClick={onRemove}
        >
          <Trash2 className="size-4" />
        </Button>
      )}
    </div>
  );
}

function ValueField({
  input,
  value,
  tags,
  onValue,
}: {
  input: ReturnType<typeof valueInputFor>;
  value: string;
  tags: TagRow[];
  onValue: (value: string) => void;
}) {
  switch (input.kind) {
    case 'none':
      return null;
    case 'number':
      return (
        <Input
          type="number"
          className="h-8 w-40"
          value={value}
          placeholder={t('segments.editor.valuePlaceholder')}
          onChange={(e) => onValue(e.target.value)}
        />
      );
    case 'days':
      return (
        <div className="flex items-center gap-1.5">
          <Input
            type="number"
            min={0}
            className="h-8 w-24"
            value={value}
            onChange={(e) => onValue(e.target.value)}
          />
          <span className="text-sm text-muted-foreground">{t('segments.editor.daysSuffix')}</span>
        </div>
      );
    case 'date':
      return (
        <Input
          type="date"
          className="h-8 w-44"
          value={value}
          onChange={(e) => onValue(e.target.value)}
        />
      );
    case 'boolean':
      return (
        <Select value={value} onValueChange={onValue}>
          <SelectTrigger size="sm" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">{t('segments.editor.booleanTrue')}</SelectItem>
            <SelectItem value="false">{t('segments.editor.booleanFalse')}</SelectItem>
          </SelectContent>
        </Select>
      );
    case 'tag':
      return (
        <Select value={value} onValueChange={onValue}>
          <SelectTrigger size="sm" className="w-48">
            <SelectValue placeholder={t('segments.editor.selectTagPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {tags.map((tag) => (
              <SelectItem key={tag.id} value={tag.name}>
                {tag.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case 'select':
      return (
        <Select value={value} onValueChange={onValue}>
          <SelectTrigger size="sm" className="w-48">
            <SelectValue placeholder={t('segments.editor.selectValuePlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {input.options.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case 'text':
      return (
        <Input
          className="h-8 w-48"
          value={value}
          placeholder={t('segments.editor.valuePlaceholder')}
          onChange={(e) => onValue(e.target.value)}
        />
      );
  }
}

function PreviewPanel({ preview, currency }: { preview: Preview; currency: string }) {
  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2">
        <span className="text-sm font-medium">{t('segments.preview.title')}</span>
        {preview.state === 'ok' && (
          <span className="text-sm tabular-nums text-muted-foreground">
            {preview.total} {t('segments.preview.count')}
          </span>
        )}
      </div>
      <div className="max-h-64 overflow-auto">
        {preview.state === 'invalid' ? (
          <p className="p-4 text-sm text-muted-foreground">{t('segments.preview.invalid')}</p>
        ) : preview.state === 'loading' ? (
          <p className="p-4 text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : preview.items.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t('segments.preview.empty')}</p>
        ) : (
          <MemberTable items={preview.items} currency={currency} />
        )}
      </div>
    </div>
  );
}
