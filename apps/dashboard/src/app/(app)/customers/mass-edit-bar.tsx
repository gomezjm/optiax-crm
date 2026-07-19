'use client';

/**
 * Mass-edit action bar (WS-D1 §5): appears over the table when rows are
 * selected. Add/remove tags, set one attribute, set consent — batched in the
 * lib module, progress + result via toasts. No mass delete.
 */
import { useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/i18n/index';
import type { DashboardSupabaseClient } from '@/lib/supabase/types';
import { convertAttributeValue } from '@/lib/customers/attribute-convert';
import { massEdit, type MassEditAction } from '@/lib/customers/mass-edit';
import { selectOptions, type AttributeDefRow, type ConsentStatus, type TagRow } from '@/lib/customers/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const CONSENT_VALUES: ConsentStatus[] = ['unknown', 'opted_in', 'opted_out'];

export function MassEditBar({
  tenantId,
  supabase,
  customerIds,
  allMatching,
  canSelectAllMatching,
  defs,
  tags,
  onSelectAllMatching,
  onClear,
  onDone,
}: {
  tenantId: string;
  supabase: DashboardSupabaseClient;
  customerIds: string[];
  allMatching: boolean;
  canSelectAllMatching: boolean;
  defs: AttributeDefRow[];
  tags: TagRow[];
  onSelectAllMatching: () => void;
  onClear: () => void;
  onDone: () => void;
}) {
  const [working, setWorking] = useState(false);
  const [tagSelection, setTagSelection] = useState<Set<string>>(new Set());
  const [attrKey, setAttrKey] = useState<string>('');
  const [attrValue, setAttrValue] = useState('');

  async function run(action: MassEditAction) {
    setWorking(true);
    const progress = toast.loading(t('customers.massEdit.working'));
    try {
      const result = await massEdit(supabase, tenantId, customerIds, action);
      toast.dismiss(progress);
      toast.success(
        `${result.updated} ${t('customers.massEdit.result')}, ${result.errors} ${t('customers.massEdit.resultErrors')}`,
      );
      onDone();
      onClear();
    } catch {
      toast.dismiss(progress);
      toast.error(t('common.errorGeneric'));
    } finally {
      setWorking(false);
    }
  }

  function runWithTags(kind: 'add_tags' | 'remove_tags') {
    const tagIds = [...tagSelection];
    if (tagIds.length === 0) return;
    setTagSelection(new Set());
    void run({ kind, tagIds });
  }

  function runSetAttribute() {
    const def = defs.find((candidate) => candidate.key === attrKey);
    if (!def) return;
    const converted = convertAttributeValue(def, attrValue);
    if (!converted.ok) {
      toast.error(t('customers.validation.attributes'));
      return;
    }
    void run({
      kind: 'set_attribute',
      key: def.key,
      value: converted.value === undefined ? null : converted.value,
    });
  }

  const selectedDef = defs.find((candidate) => candidate.key === attrKey);

  return (
    <div className="flex flex-wrap items-center gap-3 border-t bg-background px-6 py-3 shadow-[0_-1px_4px_rgba(0,0,0,0.06)]">
      <span className="text-sm font-medium">
        {customerIds.length}{' '}
        {allMatching
          ? t('customers.massEdit.allMatchingSelected')
          : t('customers.massEdit.selected')}
      </span>
      {canSelectAllMatching && (
        <Button variant="link" size="sm" className="h-auto p-0" onClick={onSelectAllMatching}>
          {t('customers.massEdit.selectAllMatching')}
        </Button>
      )}

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <TagActionDropdown
          labelKey="add"
          tags={tags}
          selection={tagSelection}
          disabled={working}
          onToggle={(id, on) =>
            setTagSelection((prev) => {
              const next = new Set(prev);
              if (on) next.add(id);
              else next.delete(id);
              return next;
            })
          }
          onApply={() => runWithTags('add_tags')}
        />
        <TagActionDropdown
          labelKey="remove"
          tags={tags}
          selection={tagSelection}
          disabled={working}
          onToggle={(id, on) =>
            setTagSelection((prev) => {
              const next = new Set(prev);
              if (on) next.add(id);
              else next.delete(id);
              return next;
            })
          }
          onApply={() => runWithTags('remove_tags')}
        />

        <div className="flex items-center gap-1">
          <Select value={attrKey} onValueChange={setAttrKey}>
            <SelectTrigger size="sm" className="w-44">
              <SelectValue placeholder={t('customers.massEdit.chooseAttribute')} />
            </SelectTrigger>
            <SelectContent>
              {defs.map((def) => (
                <SelectItem key={def.id} value={def.key}>
                  {def.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedDef?.type === 'select' ? (
            <Select value={attrValue} onValueChange={setAttrValue}>
              <SelectTrigger size="sm" className="w-36">
                <SelectValue placeholder={t('customers.massEdit.chooseValue')} />
              </SelectTrigger>
              <SelectContent>
                {selectOptions(selectedDef).map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : selectedDef?.type === 'boolean' ? (
            <Select value={attrValue} onValueChange={setAttrValue}>
              <SelectTrigger size="sm" className="w-24">
                <SelectValue placeholder={t('customers.massEdit.chooseValue')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="true">{t('common.yes')}</SelectItem>
                <SelectItem value="false">{t('common.no')}</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <Input
              type={selectedDef?.type === 'number' ? 'number' : selectedDef?.type === 'date' ? 'date' : 'text'}
              className="h-8 w-36"
              placeholder={t('customers.massEdit.chooseValue')}
              value={attrValue}
              onChange={(e) => setAttrValue(e.target.value)}
              disabled={!selectedDef}
            />
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={working || !selectedDef}
            onClick={runSetAttribute}
          >
            {t('customers.massEdit.setAttribute')}
          </Button>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={working}>
              {t('customers.massEdit.setConsent')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {CONSENT_VALUES.map((value) => (
              <DropdownMenuItem
                key={value}
                onSelect={() => void run({ kind: 'set_consent', consent: value })}
              >
                {t(`customers.consent.${value}`)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button size="sm" variant="ghost" onClick={onClear} disabled={working}>
          <X className="size-4" />
          {t('customers.massEdit.clearSelection')}
        </Button>
      </div>
    </div>
  );
}

function TagActionDropdown({
  labelKey,
  tags,
  selection,
  disabled,
  onToggle,
  onApply,
}: {
  labelKey: 'add' | 'remove';
  tags: TagRow[];
  selection: Set<string>;
  disabled: boolean;
  onToggle: (id: string, on: boolean) => void;
  onApply: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled}>
          {labelKey === 'add'
            ? t('customers.massEdit.addTags')
            : t('customers.massEdit.removeTags')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {tags.map((tag) => (
          <DropdownMenuCheckboxItem
            key={tag.id}
            checked={selection.has(tag.id)}
            onCheckedChange={(checked) => onToggle(tag.id, checked)}
            onSelect={(e) => e.preventDefault()}
          >
            <span className="size-2.5 rounded-full" style={{ backgroundColor: tag.color }} />
            {tag.name}
          </DropdownMenuCheckboxItem>
        ))}
        <div className="p-2">
          <Button size="sm" className="w-full" disabled={selection.size === 0} onClick={onApply}>
            {t('common.apply')}
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
