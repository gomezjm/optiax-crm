'use client';

/**
 * The Playground (ws-d3 §4): a chat against the live runtime in draft mode. It
 * sends the CURRENT form config (saved or not) with each turn, shows the agent's
 * reply, and — distinctly — the tool actions it *would* take. A banner makes
 * clear nothing is real; errors degrade to a friendly message.
 */
import { useRef, useState } from 'react';
import type { AgentConfig, PlaygroundToolCall } from '@optiax/shared';
import { t } from '@/i18n/index';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { callPlayground, RuntimeApiError } from '@/lib/agent/runtime';

interface Entry {
  role: 'user' | 'assistant';
  text: string;
  toolCalls?: PlaygroundToolCall[];
  handoff?: boolean;
}

function toolLabel(name: string): string {
  switch (name) {
    case 'create_order':
      return t('agent.playground.actionOrder');
    case 'capture_customer':
      return t('agent.playground.actionCapture');
    case 'check_catalog':
      return t('agent.playground.actionCatalog');
    case 'handoff_to_human':
      return t('agent.playground.actionHandoff');
    default:
      return t('agent.playground.actionGeneric');
  }
}

/** A short human detail for a would-be tool action, from its result payload. */
function toolDetail(call: PlaygroundToolCall, currency: string): string | null {
  if (!call.ok) return null;
  const result = call.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const r = result as Record<string, unknown>;
  if (call.name === 'create_order' && typeof r.total === 'number') {
    return formatMoney(r.total, typeof r.currency === 'string' ? r.currency : currency);
  }
  if (call.name === 'capture_customer' && Array.isArray(r.saved)) {
    return (r.saved as unknown[]).filter((s): s is string => typeof s === 'string').join(', ');
  }
  return null;
}

function errorMessage(err: unknown): string {
  if (err instanceof RuntimeApiError) {
    switch (err.code) {
      case 'rate_limited':
        return t('agent.playground.errorRateLimited');
      case 'unauthorized':
        return t('agent.playground.errorUnauthorized');
      case 'network':
        return t('agent.playground.errorNetwork');
      default:
        return t('agent.playground.errorServer');
    }
  }
  return t('agent.playground.errorServer');
}

export function PlaygroundPanel({
  config,
  currency,
  getToken,
}: {
  config: AgentConfig;
  currency: string;
  getToken: () => Promise<string | null>;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setError(null);
    setBusy(true);

    const history = entries.map((e) => ({ role: e.role, text: e.text }));
    const nextEntries: Entry[] = [...entries, { role: 'user', text }];
    setEntries(nextEntries);
    setInput('');

    try {
      const token = await getToken();
      if (!token) {
        setError(t('agent.playground.errorUnauthorized'));
        return;
      }
      const response = await callPlayground(token, { config, messages: history, newMessage: text });
      setEntries((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: response.reply,
          toolCalls: response.toolCalls,
          handoff: response.handoff,
        },
      ]);
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col rounded-lg border">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{t('agent.playground.title')}</h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setEntries([]);
            setError(null);
          }}
          disabled={entries.length === 0}
        >
          {t('agent.playground.reset')}
        </Button>
      </div>

      <div className="border-b bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        {t('agent.playground.banner')}
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {entries.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('agent.playground.empty')}</p>
        )}
        {entries.map((entry, i) => (
          <div key={i} className={cn('flex flex-col gap-1', entry.role === 'user' && 'items-end')}>
            <div
              className={cn(
                'max-w-[85%] rounded-lg px-3 py-2 text-sm',
                entry.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground',
              )}
            >
              {entry.text}
            </div>
            {entry.role === 'assistant' && entry.toolCalls && entry.toolCalls.length > 0 && (
              <div className="max-w-[85%] space-y-1 rounded-md border border-dashed p-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t('agent.playground.actionsTitle')}
                </p>
                {entry.toolCalls.map((call, j) => {
                  const detail = toolDetail(call, currency);
                  return (
                    <p key={j} className="text-xs">
                      • {toolLabel(call.name)}
                      {detail ? `: ${detail}` : ''}
                    </p>
                  );
                })}
              </div>
            )}
            {entry.role === 'assistant' && entry.handoff && (
              <p className="max-w-[85%] text-xs text-amber-700 dark:text-amber-300">
                {t('agent.playground.handoffNote')}
              </p>
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="border-t px-4 py-2 text-xs text-destructive" role="alert">
          {error}
        </div>
      )}

      <div className="flex gap-2 border-t p-3">
        <Input
          value={input}
          disabled={busy}
          placeholder={t('agent.playground.placeholder')}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Button type="button" onClick={() => void send()} disabled={busy || input.trim().length === 0}>
          {busy ? t('agent.playground.sending') : t('agent.playground.send')}
        </Button>
      </div>
    </div>
  );
}
