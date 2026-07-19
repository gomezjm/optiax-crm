'use client';

/**
 * Search + combinable filters (WS-D1 §2). Simple filters (consent, source,
 * tags) apply immediately; attribute + metric filters live in a dropdown
 * panel with an explicit "Aplicar". Every change resets to page 1.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { t } from '@/i18n/index';
import type { AttributeFilter, CustomerFilterModel } from '@/lib/customers/filter-model';
import {
  selectOptions,
  type AttributeDefRow,
  type ConsentStatus,
  type CustomerSource,
  type TagRow,
} from '@/lib/customers/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const CONSENT_OPTIONS = ['unknown', 'opted_in', 'opted_out'] as const;
const SOURCE_OPTIONS = ['agent', 'manual', 'import', 'coexistence_sync'] as const;
const ANY = '__any__';

export function FilterBar({
  defs,
  tags,
  model,
  onChange,
}: {
  defs: AttributeDefRow[];
  tags: TagRow[];
  model: CustomerFilterModel;
  onChange: (next: CustomerFilterModel) => void;
}) {
  const [search, setSearch] = useState(model.search ?? '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modelRef = useRef(model);
  modelRef.current = model;

  // Keep the input in sync when the URL changes from elsewhere (clear filters).
  useEffect(() => {
    setSearch(model.search ?? '');
  }, [model.search]);

  function onSearchChange(value: string) {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const current = modelRef.current;
      const next = { ...current, page: 1 };
      if (value.trim()) next.search = value.trim();
      else delete next.search;
      onChange(next);
    }, 350);
  }

  function apply(partial: Partial<CustomerFilterModel>) {
    onChange({ ...model, ...partial, page: 1 });
  }

  const activeTagIds = new Set(model.tagIds ?? []);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-background px-6 py-3">
      <div className="relative">
        <Search className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('customers.searchPlaceholder')}
          className="w-72 pl-8"
        />
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            {t('customers.filters.tags')}
            {activeTagIds.size > 0 && (
              <Badge variant="secondary" className="px-1">
                {activeTagIds.size}
              </Badge>
            )}
            <ChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {tags.map((tag) => (
            <DropdownMenuCheckboxItem
              key={tag.id}
              checked={activeTagIds.has(tag.id)}
              onCheckedChange={(checked) => {
                const next = new Set(activeTagIds);
                if (checked) next.add(tag.id);
                else next.delete(tag.id);
                const tagIds = [...next];
                if (tagIds.length > 0) apply({ tagIds });
                else {
                  const rest = { ...model, page: 1 };
                  delete rest.tagIds;
                  onChange(rest);
                }
              }}
              onSelect={(e) => e.preventDefault()}
            >
              <span
                className="inline-block size-2.5 rounded-full"
                style={{ backgroundColor: tag.color }}
              />
              {tag.name}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Select
        value={model.consent ?? ANY}
        onValueChange={(value) => {
          if (value === ANY) {
            const rest = { ...model, page: 1 };
            delete rest.consent;
            onChange(rest);
          } else {
            apply({ consent: value as ConsentStatus });
          }
        }}
      >
        <SelectTrigger size="sm" className="w-44">
          <span className="text-muted-foreground">{t('customers.filters.consent')}:</span>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{t('customers.filters.any')}</SelectItem>
          {CONSENT_OPTIONS.map((value) => (
            <SelectItem key={value} value={value}>
              {t(`customers.consent.${value}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={model.source ?? ANY}
        onValueChange={(value) => {
          if (value === ANY) {
            const rest = { ...model, page: 1 };
            delete rest.source;
            onChange(rest);
          } else {
            apply({ source: value as CustomerSource });
          }
        }}
      >
        <SelectTrigger size="sm" className="w-40">
          <span className="text-muted-foreground">{t('customers.filters.source')}:</span>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{t('customers.filters.any')}</SelectItem>
          {SOURCE_OPTIONS.map((value) => (
            <SelectItem key={value} value={value}>
              {t(`customers.source.${value}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <AdvancedFilters defs={defs} model={model} onApply={(next) => onChange({ ...next, page: 1 })} />

      {hasAnyFilter(model) && (
        <Button variant="ghost" size="sm" onClick={() => onChange({})}>
          <X className="size-3" />
          {t('customers.clearFilters')}
        </Button>
      )}
    </div>
  );
}

function hasAnyFilter(model: CustomerFilterModel): boolean {
  return Boolean(
    model.search ||
      model.tagIds?.length ||
      model.consent ||
      model.source ||
      model.attributes?.length ||
      model.totalSpentMin !== undefined ||
      model.totalSpentMax !== undefined ||
      model.lastOrderOlderThanDays !== undefined ||
      model.lastOrderNewerThanDays !== undefined,
  );
}

/**
 * Attribute + metric filters. Local draft state (strings) is committed to the
 * model only on "Aplicar" so half-typed ranges don't thrash the URL.
 */
function AdvancedFilters({
  defs,
  model,
  onApply,
}: {
  defs: AttributeDefRow[];
  model: CustomerFilterModel;
  onApply: (next: CustomerFilterModel) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const activeCount =
    (model.attributes?.length ?? 0) +
    (model.totalSpentMin !== undefined || model.totalSpentMax !== undefined ? 1 : 0) +
    (model.lastOrderOlderThanDays !== undefined || model.lastOrderNewerThanDays !== undefined
      ? 1
      : 0);

  // Rebuild the draft from the model each time the panel opens.
  useEffect(() => {
    if (!open) return;
    const next: Record<string, string> = {};
    for (const attr of model.attributes ?? []) {
      switch (attr.type) {
        case 'select':
          next[`attr.${attr.key}`] = attr.value;
          break;
        case 'boolean':
          next[`attr.${attr.key}`] = String(attr.value);
          break;
        case 'text':
          next[`attr.${attr.key}`] = attr.contains;
          break;
        case 'number':
        case 'date':
          if (attr.min !== undefined) next[`attr.${attr.key}.min`] = String(attr.min);
          if (attr.max !== undefined) next[`attr.${attr.key}.max`] = String(attr.max);
          break;
      }
    }
    if (model.totalSpentMin !== undefined) next['spentMin'] = String(model.totalSpentMin);
    if (model.totalSpentMax !== undefined) next['spentMax'] = String(model.totalSpentMax);
    if (model.lastOrderOlderThanDays !== undefined) {
      next['orderOlder'] = String(model.lastOrderOlderThanDays);
    }
    if (model.lastOrderNewerThanDays !== undefined) {
      next['orderNewer'] = String(model.lastOrderNewerThanDays);
    }
    setDraft(next);
  }, [open, model]);

  function set(key: string, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function commit() {
    const attributes: AttributeFilter[] = [];
    for (const def of defs) {
      const base = `attr.${def.key}`;
      switch (def.type) {
        case 'select': {
          const value = draft[base];
          if (value) attributes.push({ key: def.key, type: 'select', value });
          break;
        }
        case 'boolean': {
          const value = draft[base];
          if (value === 'true' || value === 'false') {
            attributes.push({ key: def.key, type: 'boolean', value: value === 'true' });
          }
          break;
        }
        case 'text': {
          const value = draft[base]?.trim();
          if (value) attributes.push({ key: def.key, type: 'text', contains: value });
          break;
        }
        case 'number': {
          const min = toNumber(draft[`${base}.min`]);
          const max = toNumber(draft[`${base}.max`]);
          if (min !== undefined || max !== undefined) {
            attributes.push({
              key: def.key,
              type: 'number',
              ...(min !== undefined ? { min } : {}),
              ...(max !== undefined ? { max } : {}),
            });
          }
          break;
        }
        case 'date': {
          const min = toDate(draft[`${base}.min`]);
          const max = toDate(draft[`${base}.max`]);
          if (min !== undefined || max !== undefined) {
            attributes.push({
              key: def.key,
              type: 'date',
              ...(min !== undefined ? { min } : {}),
              ...(max !== undefined ? { max } : {}),
            });
          }
          break;
        }
      }
    }

    const next: CustomerFilterModel = { ...model };
    delete next.attributes;
    delete next.totalSpentMin;
    delete next.totalSpentMax;
    delete next.lastOrderOlderThanDays;
    delete next.lastOrderNewerThanDays;
    if (attributes.length > 0) next.attributes = attributes;
    const spentMin = toNumber(draft['spentMin']);
    if (spentMin !== undefined) next.totalSpentMin = spentMin;
    const spentMax = toNumber(draft['spentMax']);
    if (spentMax !== undefined) next.totalSpentMax = spentMax;
    const orderOlder = toPositiveInt(draft['orderOlder']);
    if (orderOlder !== undefined) next.lastOrderOlderThanDays = orderOlder;
    const orderNewer = toPositiveInt(draft['orderNewer']);
    if (orderNewer !== undefined) next.lastOrderNewerThanDays = orderNewer;

    onApply(next);
    setOpen(false);
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          {t('customers.filters.open')}
          {activeCount > 0 && (
            <Badge variant="secondary" className="px-1">
              {activeCount}
            </Badge>
          )}
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 p-3">
        <div className="flex max-h-96 flex-col gap-4 overflow-y-auto pr-1">
          {defs.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="text-xs font-medium text-muted-foreground">
                {t('customers.filters.attributes')}
              </div>
              {defs.map((def) => (
                <AttributeFilterInput key={def.id} def={def} draft={draft} onSet={set} />
              ))}
            </div>
          )}

          <div className="flex flex-col gap-3">
            <div className="text-xs font-medium text-muted-foreground">
              {t('customers.filters.metrics')}
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">{t('customers.filters.totalSpent')}</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  placeholder={t('common.min')}
                  value={draft['spentMin'] ?? ''}
                  onChange={(e) => set('spentMin', e.target.value)}
                />
                <Input
                  type="number"
                  placeholder={t('common.max')}
                  value={draft['spentMax'] ?? ''}
                  onChange={(e) => set('spentMax', e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">{t('customers.filters.lastOrder')}</Label>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="w-40 text-xs text-muted-foreground">
                    {t('customers.filters.olderThanDays')}
                  </span>
                  <Input
                    type="number"
                    value={draft['orderOlder'] ?? ''}
                    onChange={(e) => set('orderOlder', e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-40 text-xs text-muted-foreground">
                    {t('customers.filters.newerThanDays')}
                  </span>
                  <Input
                    type="number"
                    value={draft['orderNewer'] ?? ''}
                    onChange={(e) => set('orderNewer', e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>

          <Button size="sm" onClick={commit}>
            {t('common.apply')}
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AttributeFilterInput({
  def,
  draft,
  onSet,
}: {
  def: AttributeDefRow;
  draft: Record<string, string>;
  onSet: (key: string, value: string) => void;
}) {
  const base = `attr.${def.key}`;
  switch (def.type) {
    case 'select':
      return (
        <div className="flex flex-col gap-1">
          <Label className="text-xs">{def.label}</Label>
          <Select value={draft[base] ?? ANY} onValueChange={(v) => onSet(base, v === ANY ? '' : v)}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t('customers.filters.any')}</SelectItem>
              {selectOptions(def).map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    case 'boolean':
      return (
        <div className="flex flex-col gap-1">
          <Label className="text-xs">{def.label}</Label>
          <Select value={draft[base] ?? ANY} onValueChange={(v) => onSet(base, v === ANY ? '' : v)}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t('customers.filters.booleanAny')}</SelectItem>
              <SelectItem value="true">{t('customers.filters.booleanTrue')}</SelectItem>
              <SelectItem value="false">{t('customers.filters.booleanFalse')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      );
    case 'text':
      return (
        <div className="flex flex-col gap-1">
          <Label className="text-xs">
            {def.label} · {t('customers.filters.textContains')}
          </Label>
          <Input value={draft[base] ?? ''} onChange={(e) => onSet(base, e.target.value)} />
        </div>
      );
    case 'number':
      return (
        <div className="flex flex-col gap-1">
          <Label className="text-xs">{def.label}</Label>
          <div className="flex gap-2">
            <Input
              type="number"
              placeholder={t('common.min')}
              value={draft[`${base}.min`] ?? ''}
              onChange={(e) => onSet(`${base}.min`, e.target.value)}
            />
            <Input
              type="number"
              placeholder={t('common.max')}
              value={draft[`${base}.max`] ?? ''}
              onChange={(e) => onSet(`${base}.max`, e.target.value)}
            />
          </div>
        </div>
      );
    case 'date':
      return (
        <div className="flex flex-col gap-1">
          <Label className="text-xs">{def.label}</Label>
          <div className="flex gap-2">
            <Input
              type="date"
              value={draft[`${base}.min`] ?? ''}
              onChange={(e) => onSet(`${base}.min`, e.target.value)}
            />
            <Input
              type="date"
              value={draft[`${base}.max`] ?? ''}
              onChange={(e) => onSet(`${base}.max`, e.target.value)}
            />
          </div>
        </div>
      );
  }
}

function toNumber(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function toPositiveInt(raw: string | undefined): number | undefined {
  const n = toNumber(raw);
  return n !== undefined && Number.isInteger(n) && n > 0 ? n : undefined;
}

function toDate(raw: string | undefined): string | undefined {
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
}
