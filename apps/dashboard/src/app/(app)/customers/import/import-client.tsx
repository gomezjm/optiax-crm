'use client';

/**
 * CSV import wizard (WS-D1 §6): upload → column mapping (auto-matched,
 * adjustable) → validation preview (first 20 rows, per-row errors) → import
 * with dedupe-skip → result with a downloadable CSV of failed rows.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import Papa from 'papaparse';
import { ArrowLeft } from 'lucide-react';
import { CustomerImportRowSchema, IMPORT_MAX_ROWS, type AttributeValue } from '@optiax/shared';
import { t, type TranslationKey } from '@/i18n/index';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import {
  autoMatchHeaders,
  CORE_IMPORT_FIELDS,
  type CoreImportField,
  type HeaderTarget,
} from '@/lib/customers/header-matching';
import { convertAttributeValue } from '@/lib/customers/attribute-convert';
import { importCustomers, type ImportResult, type ImportRowRef } from '@/lib/customers/import';
import type { AttributeDefRow } from '@/lib/customers/types';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type Step = 'upload' | 'mapping' | 'preview' | 'result';

interface RowIssue {
  rowNumber: number;
  messages: string[];
}

const CORE_LABEL_KEYS: Record<CoreImportField, TranslationKey> = {
  name: 'customers.drawer.name',
  phone: 'customers.drawer.phone',
  email: 'customers.drawer.email',
  address: 'customers.drawer.address',
  city: 'customers.drawer.city',
  gender: 'customers.drawer.gender',
  age_group: 'customers.drawer.ageGroup',
  consent_status: 'customers.drawer.consent',
};

const IGNORE = 'ignore';

function targetId(target: HeaderTarget): string {
  if (target.kind === 'core') return `core:${target.field}`;
  if (target.kind === 'attribute') return `attr:${target.key}`;
  return IGNORE;
}

function targetFromId(id: string): HeaderTarget {
  if (id.startsWith('core:')) return { kind: 'core', field: id.slice(5) as CoreImportField };
  if (id.startsWith('attr:')) return { kind: 'attribute', key: id.slice(5) };
  return { kind: 'ignore' };
}

export function ImportClient({ tenantId, defs }: { tenantId: string; defs: AttributeDefRow[] }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [step, setStep] = useState<Step>('upload');
  const [uploadError, setUploadError] = useState<TranslationKey | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [targets, setTargets] = useState<HeaderTarget[]>([]);
  const [validRefs, setValidRefs] = useState<ImportRowRef[]>([]);
  const [issues, setIssues] = useState<RowIssue[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  function onFile(file: File) {
    setUploadError(null);
    Papa.parse<string[]>(file, {
      skipEmptyLines: 'greedy',
      complete: (parsed) => {
        if (parsed.errors.length > 0 && parsed.data.length === 0) {
          setUploadError('customers.import.parseError');
          return;
        }
        const [headerRow, ...dataRows] = parsed.data;
        if (!headerRow || dataRows.length === 0) {
          setUploadError('customers.import.noRows');
          return;
        }
        if (dataRows.length > IMPORT_MAX_ROWS) {
          setUploadError('customers.import.tooManyRows');
          return;
        }
        setHeaders(headerRow);
        setRawRows(dataRows);
        setTargets(autoMatchHeaders(headerRow, defs));
        setStep('mapping');
      },
      error: () => setUploadError('customers.import.parseError'),
    });
  }

  const mappingComplete =
    targets.some((target) => target.kind === 'core' && target.field === 'phone') &&
    targets.some((target) => target.kind === 'core' && target.field === 'name');

  function validateRows() {
    const refs: ImportRowRef[] = [];
    const rowIssues: RowIssue[] = [];

    rawRows.forEach((cells, index) => {
      const rowNumber = index + 1;
      const messages: string[] = [];
      const core: Partial<Record<CoreImportField, string>> = {};
      const attributes: Record<string, AttributeValue> = {};

      targets.forEach((target, column) => {
        const cell = (cells[column] ?? '').trim();
        if (target.kind === 'core') {
          core[target.field] = cell;
        } else if (target.kind === 'attribute') {
          const def = defs.find((candidate) => candidate.key === target.key);
          if (!def) return;
          const converted = convertAttributeValue(def, cell);
          if (!converted.ok) {
            messages.push(`${def.label}: ${cell}`);
          } else if (converted.value !== undefined) {
            attributes[def.key] = converted.value;
          }
        }
      });

      const parsed = CustomerImportRowSchema.safeParse({
        name: core.name ?? '',
        phone: core.phone ?? '',
        email: core.email ?? '',
        address: core.address ?? '',
        city: core.city ?? '',
        gender: core.gender ?? '',
        age_group: core.age_group ?? '',
        consent_status: core.consent_status ?? '',
        attributes,
      });

      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const field = String(issue.path[0] ?? '');
          const labelKey =
            field in CORE_LABEL_KEYS ? CORE_LABEL_KEYS[field as CoreImportField] : null;
          messages.push(labelKey ? t(labelKey) : t('customers.validation.generic'));
        }
      }

      if (messages.length > 0) {
        rowIssues.push({ rowNumber, messages: [...new Set(messages)] });
      } else if (parsed.success) {
        refs.push({ rowNumber, row: parsed.data });
      }
    });

    setValidRefs(refs);
    setIssues(rowIssues);
    setStep('preview');
  }

  async function runImport() {
    setImporting(true);
    setProgress({ done: 0, total: validRefs.length });
    try {
      const outcome = await importCustomers(supabase, tenantId, validRefs, (done, total) =>
        setProgress({ done, total }),
      );
      setResult(outcome);
      setStep('result');
    } finally {
      setImporting(false);
    }
  }

  function downloadFailedCsv() {
    if (!result) return;
    const failedRows: string[][] = [];
    for (const issue of issues) {
      const cells = rawRows[issue.rowNumber - 1] ?? [];
      failedRows.push([...cells, issue.messages.join('; ')]);
    }
    for (const failure of result.failed) {
      const cells = rawRows[failure.rowNumber - 1] ?? [];
      failedRows.push([...cells, failure.reason]);
    }
    const csv = Papa.unparse({
      fields: [...headers, t('customers.import.failedReasonHeader')],
      data: failedRows,
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'clientes-con-error.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const stepLabel: Record<Step, TranslationKey> = {
    upload: 'customers.import.stepUpload',
    mapping: 'customers.import.stepMapping',
    preview: 'customers.import.stepPreview',
    result: 'customers.import.stepResult',
  };

  return (
    <div className="flex h-full flex-col overflow-auto">
      <header className="flex items-center justify-between border-b bg-background px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">{t('customers.import.title')}</h1>
          <p className="text-sm text-muted-foreground">{t(stepLabel[step])}</p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/customers">
            <ArrowLeft className="size-4" />
            {t('customers.import.backToList')}
          </Link>
        </Button>
      </header>

      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-6">
        {step === 'upload' && (
          <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed p-12 text-center">
            <p className="text-sm">{t('customers.import.uploadPrompt')}</p>
            <p className="text-xs text-muted-foreground">{t('customers.import.uploadHint')}</p>
            <label>
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onFile(file);
                }}
              />
              <Button asChild>
                <span>{t('customers.import.uploadButton')}</span>
              </Button>
            </label>
            {uploadError && <p className="text-sm text-destructive">{t(uploadError)}</p>}
          </div>
        )}

        {step === 'mapping' && (
          <>
            <p className="text-sm text-muted-foreground">{t('customers.import.mappingIntro')}</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('customers.import.mappingColumn')}</TableHead>
                  <TableHead>{t('customers.import.mappingTarget')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {headers.map((header, index) => (
                  <TableRow key={`${header}-${index}`}>
                    <TableCell className="font-medium">{header}</TableCell>
                    <TableCell>
                      <Select
                        value={targetId(targets[index] ?? { kind: 'ignore' })}
                        onValueChange={(id) =>
                          setTargets((prev) => {
                            const next = [...prev];
                            next[index] = targetFromId(id);
                            return next;
                          })
                        }
                      >
                        <SelectTrigger size="sm" className="w-64">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={IGNORE}>
                            {t('customers.import.mappingIgnore')}
                          </SelectItem>
                          {CORE_IMPORT_FIELDS.map((field) => (
                            <SelectItem key={field} value={`core:${field}`}>
                              {t(CORE_LABEL_KEYS[field])}
                            </SelectItem>
                          ))}
                          {defs.map((def) => (
                            <SelectItem key={def.id} value={`attr:${def.key}`}>
                              {t('customers.import.mappingAttributePrefix')} {def.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!mappingComplete && (
              <p className="text-sm text-amber-700">{t('customers.import.mappingNeedsPhone')}</p>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep('upload')}>
                {t('common.back')}
              </Button>
              <Button disabled={!mappingComplete} onClick={validateRows}>
                {t('common.next')}
              </Button>
            </div>
          </>
        )}

        {step === 'preview' && (
          <>
            <div className="flex gap-6 text-sm">
              <span className="font-medium text-green-700">
                {validRefs.length} {t('customers.import.previewValid')}
              </span>
              <span className="font-medium text-red-700">
                {issues.length} {t('customers.import.previewInvalid')}
              </span>
            </div>

            <p className="text-sm text-muted-foreground">{t('customers.import.previewIntro')}</p>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    {headers.map((header, index) => (
                      <TableHead key={`${header}-${index}`}>{header}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rawRows.slice(0, 20).map((cells, index) => {
                    const hasIssue = issues.some((issue) => issue.rowNumber === index + 1);
                    return (
                      <TableRow key={index} className={hasIssue ? 'bg-red-50' : undefined}>
                        <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                        {headers.map((_, column) => (
                          <TableCell key={column}>{cells[column] ?? ''}</TableCell>
                        ))}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {issues.length > 0 && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm">
                <p className="mb-1 font-medium text-red-800">
                  {t('customers.import.previewErrorsTitle')}
                </p>
                <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto text-red-800">
                  {issues.map((issue) => (
                    <li key={issue.rowNumber}>
                      {t('customers.import.previewRow')} {issue.rowNumber}:{' '}
                      {issue.messages.join(', ')}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setStep('mapping')} disabled={importing}>
                {t('common.back')}
              </Button>
              <Button disabled={validRefs.length === 0 || importing} onClick={() => void runImport()}>
                {importing
                  ? `${t('customers.import.importing')} ${progress ? `${progress.done}/${progress.total}` : ''}`
                  : `${t('customers.import.startImport')} (${validRefs.length})`}
              </Button>
            </div>
          </>
        )}

        {step === 'result' && result && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-4">
              <ResultCard
                value={result.imported}
                labelKey="customers.import.resultImported"
                tone="text-green-700"
              />
              <ResultCard
                value={result.skipped.length}
                labelKey="customers.import.resultSkipped"
                tone="text-amber-700"
              />
              <ResultCard
                value={result.failed.length + issues.length}
                labelKey="customers.import.resultFailed"
                tone="text-red-700"
              />
            </div>
            {(result.failed.length > 0 || issues.length > 0) && (
              <Button variant="outline" onClick={downloadFailedCsv}>
                {t('customers.import.downloadFailed')}
              </Button>
            )}
            <Button asChild>
              <Link href="/customers">{t('customers.import.done')}</Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ResultCard({
  value,
  labelKey,
  tone,
}: {
  value: number;
  labelKey: TranslationKey;
  tone: string;
}) {
  return (
    <div className="rounded-lg border p-4 text-center">
      <div className={`text-2xl font-semibold ${tone}`}>{value}</div>
      <div className="text-sm text-muted-foreground">{t(labelKey)}</div>
    </div>
  );
}
