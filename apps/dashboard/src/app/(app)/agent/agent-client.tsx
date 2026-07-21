'use client';

/**
 * Configurator orchestrator (ws-d3 §3–§6). Owns the draft config in state, runs
 * live AgentConfigSchema validation, saves the draft, flips the master toggle,
 * and hosts the Playground + Publish panels. Read-only for a sales_rep.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { validateAgentConfig, type AgentConfig } from '@optiax/shared';
import { t } from '@/i18n/index';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { saveDraft, setAgentEnabled } from '@/lib/agent/mutations';
import { useUnsavedGuard } from '@/components/shell/nav-guard';
import type { AgentScreenData } from '@/lib/agent/types';
import { ConfigForm } from './config-form';
import { PlaygroundPanel } from './playground-panel';
import { PublishPanel } from './publish-panel';
import type { FieldErrors } from './fields';

/** Minimal valid config for the rare tenant with neither a draft nor a published row. */
const DEFAULT_RESULT = validateAgentConfig({
  version: 1,
  business: { name: 'Mi negocio', description: 'Describe tu negocio aquí.', vertical: 'retail' },
  agent: {
    displayName: 'Asistente',
    tone: 'cercano',
    language: 'es',
    emojiUsage: 'light',
    audioPolicy: 'transcribe',
    operatingMode: 'always',
    pauseHoursOnOwnerReply: 24,
  },
  catalog: { canQuotePrices: true, offerPromos: false, outOfStock: 'say_unavailable' },
  faqs: [],
  capture: { fields: [] },
  orders: { enabled: false, confirmBeforeCreate: true, collectDelivery: false, sharePaymentMethods: false },
  escalation: { rules: [], handoffMessage: 'Te paso con una persona del equipo.' },
  guardrails: { forbiddenTopics: [], custom: [] },
});
// The literal above validates; empty name/displayName only fail min-length, which
// is fine — the form seeds from it and shows those as the first fields to fill.
const DEFAULT_CONFIG: AgentConfig = DEFAULT_RESULT.ok
  ? DEFAULT_RESULT.config
  : (() => {
      throw new Error('default agent config failed validation');
    })();

export function AgentClient({ data }: { data: AgentScreenData }) {
  const router = useRouter();
  const supabase = useRef(createSupabaseBrowserClient());
  const isAdmin = data.role === 'admin';

  const seed = data.draft ?? data.published ?? DEFAULT_CONFIG;
  const [config, setConfig] = useState<AgentConfig>(seed);
  const [savedConfig, setSavedConfig] = useState<AgentConfig>(seed);
  const [hasDraft, setHasDraft] = useState(data.draft !== null);
  const [agentEnabled, setEnabled] = useState(data.agentEnabled);
  const [saving, setSaving] = useState(false);

  const validation = useMemo(() => validateAgentConfig(config), [config]);
  const valid = validation.ok;
  const errors = useMemo<FieldErrors>(() => {
    const map: FieldErrors = new Map();
    if (!validation.ok) for (const e of validation.errors) if (!map.has(e.path)) map.set(e.path, e.message);
    return map;
  }, [validation]);

  const dirty = useMemo(() => JSON.stringify(config) !== JSON.stringify(savedConfig), [config, savedConfig]);
  const draftDiffers = hasDraft && JSON.stringify(savedConfig) !== JSON.stringify(data.published);

  // In-app navigation (sidebar clicks) confirms before discarding edits (§0.2);
  // `beforeunload` below only covers browser-level nav/refresh/close.
  useUnsavedGuard(dirty);

  // Warn before leaving with unsaved edits (browser-level nav/refresh/close).
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const getToken = useCallback(async () => {
    const { data: session } = await supabase.current.auth.getSession();
    return session.session?.access_token ?? null;
  }, []);

  const set = useCallback((updater: (c: AgentConfig) => AgentConfig) => setConfig(updater), []);

  async function onSave() {
    if (!validation.ok) {
      toast.error(t('agent.invalidHint'));
      return;
    }
    setSaving(true);
    try {
      await saveDraft(supabase.current, data.tenantId, validation.config);
      setSavedConfig(validation.config);
      setHasDraft(true);
      toast.success(t('agent.saved'));
    } catch {
      toast.error(t('agent.saveError'));
    } finally {
      setSaving(false);
    }
  }

  async function onToggleAgent(next: boolean) {
    setEnabled(next);
    try {
      await setAgentEnabled(supabase.current, data.tenantId, next);
      toast.success(next ? t('agent.master.enabled') : t('agent.master.disabled'));
    } catch {
      setEnabled(!next); // revert on failure
      toast.error(t('common.errorGeneric'));
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">{t('agent.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('agent.subtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t('agent.master.title')}</span>
            <button
              type="button"
              role="switch"
              aria-checked={agentEnabled}
              disabled={!isAdmin}
              onClick={() => void onToggleAgent(!agentEnabled)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                agentEnabled ? 'bg-emerald-600 text-white' : 'bg-muted text-muted-foreground'
              } ${!isAdmin ? 'opacity-60' : ''}`}
            >
              {agentEnabled ? t('agent.master.on') : t('agent.master.off')}
            </button>
          </label>
          {isAdmin && (
            <Button type="button" onClick={() => void onSave()} disabled={saving || !dirty || !valid}>
              {saving ? t('common.saving') : t('agent.save')}
            </Button>
          )}
          {isAdmin && dirty && <Badge variant="outline">{t('agent.unsaved')}</Badge>}
        </div>
      </header>

      {!isAdmin && (
        <div className="border-b bg-muted px-6 py-2 text-sm text-muted-foreground">
          {t('agent.readOnlyBanner')}
        </div>
      )}
      {isAdmin && !valid && (
        <div className="border-b bg-destructive/10 px-6 py-2 text-sm text-destructive">
          {t('agent.invalidHint')}
        </div>
      )}

      <div className="grid flex-1 grid-cols-1 gap-6 overflow-hidden p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="overflow-y-auto pr-2">
          <ConfigForm
            config={config}
            set={set}
            errors={errors}
            disabled={!isAdmin}
            captureOptions={data.captureOptions}
          />
        </div>
        <div className="flex flex-col gap-6 overflow-y-auto">
          <div className="min-h-[24rem] flex-1">
            <PlaygroundPanel config={config} currency={data.currency} getToken={getToken} />
          </div>
          <PublishPanel
            getToken={getToken}
            isAdmin={isAdmin}
            saved={hasDraft && !dirty}
            valid={valid}
            publishedAt={data.publishedAt}
            compilerVersion={data.publishedCompilerVersion}
            draftDiffers={draftDiffers}
            onPublished={() => router.refresh()}
          />
        </div>
      </div>
    </div>
  );
}
