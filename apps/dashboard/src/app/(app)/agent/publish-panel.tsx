'use client';

/**
 * The Publish flow UI (ws-d3 §5). Runs R3's gate through the runtime and, on a
 * pass, publishes; on a fail, shows what broke per eval case so the owner can
 * fix the config. Admin-only — a rep never sees the buttons enabled. The draft
 * must be saved (the runtime gates the DB draft) and free of validation errors.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import type { EvalCaseResult, EvalRunResult } from '@optiax/shared';
import { t } from '@/i18n/index';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/format';
import { callEvaluate, callPublish, RuntimeApiError } from '@/lib/agent/runtime';

interface PublishPanelProps {
  getToken: () => Promise<string | null>;
  isAdmin: boolean;
  /** Draft is persisted and the form has no unsaved edits. */
  saved: boolean;
  /** Form passes AgentConfigSchema. */
  valid: boolean;
  publishedAt: string | null;
  compilerVersion: string | null;
  draftDiffers: boolean;
  onPublished: () => void;
}

type Panel =
  | { kind: 'blocked'; evaluation: EvalRunResult }
  | { kind: 'passed'; evaluation: EvalRunResult }
  | null;

function errorToast(err: unknown): string {
  if (err instanceof RuntimeApiError) {
    switch (err.code) {
      case 'no_draft':
        return t('agent.publish.errorNoDraft');
      case 'forbidden':
        return t('agent.publish.errorForbidden');
      case 'unauthorized':
        return t('agent.playground.errorUnauthorized');
      default:
        return t('agent.publish.errorServer');
    }
  }
  return t('agent.publish.errorServer');
}

function CaseRow({ result }: { result: EvalCaseResult }) {
  const passed = result.deterministicPass && result.judgePass;
  const failedChecks = result.checks.filter((c) => !c.pass);
  return (
    <div className="rounded-md border p-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{result.title}</span>
        <Badge variant={passed ? 'outline' : 'destructive'}>
          {passed ? t('agent.publish.checkOk') : t('agent.publish.checkFail')}
        </Badge>
      </div>
      {failedChecks.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-muted-foreground">
          {failedChecks.map((c, i) => (
            <li key={i}>
              • {c.check.kind}
              {c.detail ? `: ${c.detail}` : ''}
            </li>
          ))}
        </ul>
      )}
      {!result.judgePass && result.judgement && (
        <p className="mt-1 text-muted-foreground">
          {t('agent.publish.caseJudge')} ({result.judgement.score}/{result.threshold}):{' '}
          {result.judgement.rationale}
        </p>
      )}
    </div>
  );
}

export function PublishPanel({
  getToken,
  isAdmin,
  saved,
  valid,
  publishedAt,
  compilerVersion,
  draftDiffers,
  onPublished,
}: PublishPanelProps) {
  const [busy, setBusy] = useState<'evaluate' | 'publish' | null>(null);
  const [panel, setPanel] = useState<Panel>(null);

  const disabledReason = !valid ? t('agent.publish.fixErrorsFirst') : !saved ? t('agent.publish.saveFirst') : null;
  const canAct = isAdmin && !disabledReason && busy === null;

  async function withToken<T>(fn: (token: string) => Promise<T>): Promise<T | undefined> {
    const token = await getToken();
    if (!token) {
      toast.error(t('agent.playground.errorUnauthorized'));
      return undefined;
    }
    return fn(token);
  }

  async function onEvaluate() {
    setBusy('evaluate');
    setPanel(null);
    try {
      const evaluation = await withToken(callEvaluate);
      if (evaluation) setPanel({ kind: evaluation.pass ? 'passed' : 'blocked', evaluation });
    } catch (err) {
      toast.error(errorToast(err));
    } finally {
      setBusy(null);
    }
  }

  async function onPublish() {
    setBusy('publish');
    setPanel(null);
    try {
      const result = await withToken(callPublish);
      if (!result) return;
      if (result.published) {
        toast.success(t('agent.publish.success'));
        setPanel({ kind: 'passed', evaluation: result.evaluation });
        onPublished();
      } else {
        setPanel({ kind: 'blocked', evaluation: result.evaluation });
      }
    } catch (err) {
      toast.error(errorToast(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <h2 className="text-sm font-semibold">{t('agent.publish.title')}</h2>

      <dl className="space-y-1 text-xs text-muted-foreground">
        <div className="flex justify-between gap-2">
          <dt>{t('agent.publish.publishedAt')}</dt>
          <dd>{publishedAt ? formatDateTime(publishedAt) : t('agent.publish.never')}</dd>
        </div>
        {compilerVersion && (
          <div className="flex justify-between gap-2">
            <dt>{t('agent.publish.compilerVersion')}</dt>
            <dd>{compilerVersion}</dd>
          </div>
        )}
      </dl>

      <p className="text-xs">
        {draftDiffers ? (
          <span className="text-amber-700 dark:text-amber-300">{t('agent.publish.draftDiffers')}</span>
        ) : (
          <span className="text-muted-foreground">{t('agent.publish.upToDate')}</span>
        )}
      </p>

      {isAdmin && (
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void onEvaluate()} disabled={!canAct}>
            {busy === 'evaluate' ? t('agent.publish.evaluating') : t('agent.publish.evaluate')}
          </Button>
          <Button type="button" size="sm" onClick={() => void onPublish()} disabled={!canAct}>
            {busy === 'publish' ? t('agent.publish.publishing') : t('agent.publish.publish')}
          </Button>
        </div>
      )}
      {isAdmin && disabledReason && <p className="text-xs text-muted-foreground">{disabledReason}</p>}

      {panel && (
        <div className="space-y-2">
          <p className={panel.kind === 'passed' ? 'text-xs font-medium text-emerald-700 dark:text-emerald-400' : 'text-xs font-medium text-destructive'}>
            {panel.kind === 'passed' ? t('agent.publish.passedTitle') : t('agent.publish.blockedTitle')}
          </p>
          <p className="text-xs text-muted-foreground">
            {panel.kind === 'passed' ? t('agent.publish.passedIntro') : t('agent.publish.blockedIntro')}
          </p>
          <div className="space-y-2">
            {panel.evaluation.cases
              .filter((c) => !c.probe)
              .map((c) => (
                <CaseRow key={c.fixtureId} result={c} />
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
