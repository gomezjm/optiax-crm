'use client';

/**
 * The structured configurator (ws-d3 §3): a single sectioned form over the
 * draft `AgentConfig`. It never exposes the compiled prompt — only the fields a
 * non-technical owner sets. Live validation errors are passed down as a
 * path→message map and rendered inline by the field primitives.
 *
 * `set` takes an updater so each control produces a fully-typed next config; the
 * parent re-validates on every change.
 */
import Link from 'next/link';
import type { AgentConfig } from '@optiax/shared';
import { t, type TranslationKey } from '@/i18n/index';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { CaptureFieldOption } from '@/lib/agent/types';
import {
  Field,
  SelectInput,
  TextAreaInput,
  TextInput,
  Toggle,
  type FieldErrors,
} from './fields';

type SetConfig = (updater: (c: AgentConfig) => AgentConfig) => void;

interface FormProps {
  config: AgentConfig;
  set: SetConfig;
  errors: FieldErrors;
  disabled: boolean;
  captureOptions: CaptureFieldOption[];
}

const DAY_KEYS: TranslationKey[] = [
  'agent.days.0',
  'agent.days.1',
  'agent.days.2',
  'agent.days.3',
  'agent.days.4',
  'agent.days.5',
  'agent.days.6',
];

/** A fresh weekday-9-to-6 schedule (mutable arrays; never share one reference). */
function defaultSchedule(): AgentConfig['agent']['schedule'] & object {
  return { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' };
}
const TRIGGERS = ['keyword', 'payment_proof', 'complaint', 'human_request'] as const;
const TRIGGER_LABELS: Record<(typeof TRIGGERS)[number], TranslationKey> = {
  keyword: 'agent.escalation.triggerKeyword',
  payment_proof: 'agent.escalation.triggerPaymentProof',
  complaint: 'agent.escalation.triggerComplaint',
  human_request: 'agent.escalation.triggerHumanRequest',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** Split a textarea into trimmed non-empty lines, and back. */
function linesToArray(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export function ConfigForm({ config, set, errors, disabled, captureOptions }: FormProps) {
  const needsSchedule =
    config.agent.operatingMode === 'schedule' || config.agent.operatingMode === 'outside_hours';
  const schedule = config.agent.schedule ?? defaultSchedule();
  const keywordRule = config.escalation.rules.find((r) => r.trigger === 'keyword');

  return (
    <div className="space-y-8">
      {/* ── Negocio ─────────────────────────────────────────────────────────── */}
      <Section title={t('agent.sections.business')}>
        <TextInput
          label={t('agent.business.name')}
          value={config.business.name}
          disabled={disabled}
          errors={errors}
          path="business.name"
          onChange={(v) => set((c) => ({ ...c, business: { ...c.business, name: v } }))}
        />
        <TextAreaInput
          label={t('agent.business.description')}
          hint={t('agent.business.descriptionHint')}
          value={config.business.description}
          disabled={disabled}
          errors={errors}
          path="business.description"
          onChange={(v) => set((c) => ({ ...c, business: { ...c.business, description: v } }))}
        />
        <SelectInput
          label={t('agent.business.vertical')}
          value={config.business.vertical}
          disabled={disabled}
          onChange={(v) => set((c) => ({ ...c, business: { ...c.business, vertical: v } }))}
          options={[
            { value: 'retail', label: t('agent.business.verticalRetail') },
            { value: 'food', label: t('agent.business.verticalFood') },
          ]}
        />
        <TextInput
          label={t('agent.business.address')}
          value={config.business.address ?? ''}
          disabled={disabled}
          errors={errors}
          path="business.address"
          onChange={(v) =>
            set((c) => ({ ...c, business: { ...c.business, address: v || undefined } }))
          }
        />
        <TextInput
          label={t('agent.business.hours')}
          value={config.business.hours ?? ''}
          disabled={disabled}
          errors={errors}
          path="business.hours"
          onChange={(v) => set((c) => ({ ...c, business: { ...c.business, hours: v || undefined } }))}
        />
      </Section>

      <Separator />

      {/* ── Personalidad ────────────────────────────────────────────────────── */}
      <Section title={t('agent.sections.personality')}>
        <TextInput
          label={t('agent.personality.displayName')}
          value={config.agent.displayName}
          disabled={disabled}
          errors={errors}
          path="agent.displayName"
          onChange={(v) => set((c) => ({ ...c, agent: { ...c.agent, displayName: v } }))}
        />
        <SelectInput
          label={t('agent.personality.tone')}
          value={config.agent.tone}
          disabled={disabled}
          onChange={(v) => set((c) => ({ ...c, agent: { ...c.agent, tone: v } }))}
          options={[
            { value: 'formal', label: t('agent.personality.toneFormal') },
            { value: 'cercano', label: t('agent.personality.toneCercano') },
            { value: 'neutral', label: t('agent.personality.toneNeutral') },
          ]}
        />
        <SelectInput
          label={t('agent.personality.emoji')}
          value={config.agent.emojiUsage}
          disabled={disabled}
          onChange={(v) => set((c) => ({ ...c, agent: { ...c.agent, emojiUsage: v } }))}
          options={[
            { value: 'none', label: t('agent.personality.emojiNone') },
            { value: 'light', label: t('agent.personality.emojiLight') },
            { value: 'frequent', label: t('agent.personality.emojiFrequent') },
          ]}
        />
        <SelectInput
          label={t('agent.personality.language')}
          value={config.agent.language}
          disabled
          onChange={() => undefined}
          options={[{ value: 'es', label: t('agent.personality.languageEs') }]}
        />
      </Section>

      <Separator />

      {/* ── Disponibilidad ──────────────────────────────────────────────────── */}
      <Section title={t('agent.sections.availability')}>
        <SelectInput
          label={t('agent.availability.operatingMode')}
          value={config.agent.operatingMode}
          disabled={disabled}
          onChange={(mode) =>
            set((c) => ({
              ...c,
              agent: {
                ...c.agent,
                operatingMode: mode,
                // Both schedule-relative modes require a schedule (R1 §8.2) —
                // seed one so the form is never in an invalid intermediate state.
                schedule:
                  (mode === 'schedule' || mode === 'outside_hours') && !c.agent.schedule
                    ? defaultSchedule()
                    : c.agent.schedule,
              },
            }))
          }
          options={[
            { value: 'always', label: t('agent.availability.modeAlways') },
            { value: 'outside_hours', label: t('agent.availability.modeOutsideHours') },
            { value: 'schedule', label: t('agent.availability.modeSchedule') },
          ]}
        />

        {needsSchedule && (
          <div className="space-y-3 rounded-md border p-3">
            <p className="text-xs text-muted-foreground">{t('agent.availability.scheduleHint')}</p>
            <Field label={t('agent.availability.days')}>
              <div className="flex flex-wrap gap-1.5">
                {DAY_KEYS.map((key, day) => {
                  const active = schedule.days.includes(day);
                  return (
                    <button
                      type="button"
                      key={day}
                      disabled={disabled}
                      aria-pressed={active}
                      onClick={() =>
                        set((c) => {
                          const current = c.agent.schedule ?? defaultSchedule();
                          const days = active
                            ? current.days.filter((d) => d !== day)
                            : [...current.days, day].sort((a, b) => a - b);
                          return { ...c, agent: { ...c.agent, schedule: { ...current, days } } };
                        })
                      }
                      className={cn(
                        'rounded-md border px-2.5 py-1 text-xs',
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-accent',
                        disabled && 'opacity-60',
                      )}
                    >
                      {t(key)}
                    </button>
                  );
                })}
              </div>
              {errors.get('agent.schedule.days') && (
                <p className="text-xs text-destructive">{errors.get('agent.schedule.days')}</p>
              )}
              {errors.get('agent.schedule') && (
                <p className="text-xs text-destructive">{errors.get('agent.schedule')}</p>
              )}
            </Field>
            <div className="flex gap-3">
              <Field label={t('agent.availability.start')} htmlFor="schedule.start">
                <Input
                  id="schedule.start"
                  type="time"
                  value={schedule.start}
                  disabled={disabled}
                  onChange={(e) =>
                    set((c) => ({
                      ...c,
                      agent: {
                        ...c.agent,
                        schedule: { ...(c.agent.schedule ?? schedule), start: e.target.value },
                      },
                    }))
                  }
                />
              </Field>
              <Field label={t('agent.availability.end')} htmlFor="schedule.end">
                <Input
                  id="schedule.end"
                  type="time"
                  value={schedule.end}
                  disabled={disabled}
                  onChange={(e) =>
                    set((c) => ({
                      ...c,
                      agent: {
                        ...c.agent,
                        schedule: { ...(c.agent.schedule ?? schedule), end: e.target.value },
                      },
                    }))
                  }
                />
              </Field>
            </div>
          </div>
        )}

        <SelectInput
          label={t('agent.availability.audioPolicy')}
          value={config.agent.audioPolicy}
          disabled={disabled}
          onChange={(v) => set((c) => ({ ...c, agent: { ...c.agent, audioPolicy: v } }))}
          options={[
            { value: 'transcribe', label: t('agent.availability.audioTranscribe') },
            { value: 'text_reply', label: t('agent.availability.audioTextReply') },
          ]}
        />
        <TextInput
          label={t('agent.availability.pauseHours')}
          hint={t('agent.availability.pauseHoursHint')}
          type="number"
          value={String(config.agent.pauseHoursOnOwnerReply)}
          disabled={disabled}
          errors={errors}
          path="agent.pauseHoursOnOwnerReply"
          onChange={(v) =>
            set((c) => ({
              ...c,
              agent: { ...c.agent, pauseHoursOnOwnerReply: v === '' ? 0 : Number(v) },
            }))
          }
        />
      </Section>

      <Separator />

      {/* ── Catálogo ────────────────────────────────────────────────────────── */}
      <Section title={t('agent.sections.catalog')}>
        <Toggle
          label={t('agent.catalog.canQuotePrices')}
          checked={config.catalog.canQuotePrices}
          disabled={disabled}
          onChange={(v) => set((c) => ({ ...c, catalog: { ...c.catalog, canQuotePrices: v } }))}
        />
        <Toggle
          label={t('agent.catalog.offerPromos')}
          checked={config.catalog.offerPromos}
          disabled={disabled}
          onChange={(v) => set((c) => ({ ...c, catalog: { ...c.catalog, offerPromos: v } }))}
        />
        <SelectInput
          label={t('agent.catalog.outOfStock')}
          value={config.catalog.outOfStock}
          disabled={disabled}
          onChange={(v) => set((c) => ({ ...c, catalog: { ...c.catalog, outOfStock: v } }))}
          options={[
            { value: 'say_unavailable', label: t('agent.catalog.outOfStockSay') },
            { value: 'suggest_alternative', label: t('agent.catalog.outOfStockSuggest') },
          ]}
        />
        <p className="text-xs text-muted-foreground">
          {t('agent.catalog.productsNote')}{' '}
          <Link href="/products" className="underline">
            {t('agent.catalog.productsLink')}
          </Link>
        </p>
      </Section>

      <Separator />

      {/* ── FAQs ────────────────────────────────────────────────────────────── */}
      <Section title={t('agent.sections.faqs')}>
        {config.faqs.length === 0 && (
          <p className="text-xs text-muted-foreground">{t('agent.faqs.empty')}</p>
        )}
        <div className="space-y-3">
          {config.faqs.map((faq, i) => (
            <div key={i} className="space-y-2 rounded-md border p-3">
              <TextInput
                label={t('agent.faqs.question')}
                value={faq.q}
                disabled={disabled}
                errors={errors}
                path={`faqs.${i}.q`}
                onChange={(v) =>
                  set((c) => ({
                    ...c,
                    faqs: c.faqs.map((f, j) => (j === i ? { ...f, q: v } : f)),
                  }))
                }
              />
              <TextAreaInput
                label={t('agent.faqs.answer')}
                value={faq.a}
                disabled={disabled}
                errors={errors}
                path={`faqs.${i}.a`}
                rows={2}
                onChange={(v) =>
                  set((c) => ({
                    ...c,
                    faqs: c.faqs.map((f, j) => (j === i ? { ...f, a: v } : f)),
                  }))
                }
              />
              {!disabled && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => set((c) => ({ ...c, faqs: c.faqs.filter((_, j) => j !== i) }))}
                >
                  {t('common.remove')}
                </Button>
              )}
            </div>
          ))}
        </div>
        {!disabled && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => set((c) => ({ ...c, faqs: [...c.faqs, { q: '', a: '' }] }))}
          >
            {t('agent.faqs.add')}
          </Button>
        )}
      </Section>

      <Separator />

      {/* ── Captura de datos ────────────────────────────────────────────────── */}
      <Section title={t('agent.sections.capture')}>
        <p className="text-xs text-muted-foreground">{t('agent.capture.intro')}</p>
        <div className="space-y-2">
          {captureOptions.map((option) => {
            const field = config.capture.fields.find((f) => f.key === option.key);
            const enabled = field !== undefined;
            return (
              <div
                key={option.key}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
              >
                <Toggle
                  label={option.label}
                  checked={enabled}
                  disabled={disabled}
                  onChange={(on) =>
                    set((c) => ({
                      ...c,
                      capture: {
                        fields: on
                          ? [...c.capture.fields, { key: option.key, required: false }]
                          : c.capture.fields.filter((f) => f.key !== option.key),
                      },
                    }))
                  }
                />
                {enabled && (
                  <Toggle
                    label={t('agent.capture.required')}
                    checked={field.required}
                    disabled={disabled}
                    onChange={(req) =>
                      set((c) => ({
                        ...c,
                        capture: {
                          fields: c.capture.fields.map((f) =>
                            f.key === option.key ? { ...f, required: req } : f,
                          ),
                        },
                      }))
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      </Section>

      <Separator />

      {/* ── Pedidos ─────────────────────────────────────────────────────────── */}
      <Section title={t('agent.sections.orders')}>
        <Toggle
          label={t('agent.orders.enabled')}
          checked={config.orders.enabled}
          disabled={disabled}
          onChange={(v) => set((c) => ({ ...c, orders: { ...c.orders, enabled: v } }))}
        />
        <Toggle
          label={t('agent.orders.confirmBeforeCreate')}
          checked={config.orders.confirmBeforeCreate}
          disabled={disabled}
          onChange={(v) => set((c) => ({ ...c, orders: { ...c.orders, confirmBeforeCreate: v } }))}
        />
        <Toggle
          label={t('agent.orders.collectDelivery')}
          checked={config.orders.collectDelivery}
          disabled={disabled}
          onChange={(v) => set((c) => ({ ...c, orders: { ...c.orders, collectDelivery: v } }))}
        />
        <Toggle
          label={t('agent.orders.sharePaymentMethods')}
          checked={config.orders.sharePaymentMethods}
          disabled={disabled}
          onChange={(v) => set((c) => ({ ...c, orders: { ...c.orders, sharePaymentMethods: v } }))}
        />
      </Section>

      <Separator />

      {/* ── Escalación ──────────────────────────────────────────────────────── */}
      <Section title={t('agent.sections.escalation')}>
        <p className="text-xs text-muted-foreground">{t('agent.escalation.intro')}</p>
        <Field label={t('agent.escalation.triggers')}>
          <div className="space-y-2">
            {TRIGGERS.map((trigger) => {
              const on = config.escalation.rules.some((r) => r.trigger === trigger);
              return (
                <Toggle
                  key={trigger}
                  label={t(TRIGGER_LABELS[trigger])}
                  checked={on}
                  disabled={disabled}
                  onChange={(checked) =>
                    set((c) => {
                      const rules = checked
                        ? [
                            ...c.escalation.rules,
                            trigger === 'keyword'
                              ? { trigger, keywords: [] as string[] }
                              : { trigger },
                          ]
                        : c.escalation.rules.filter((r) => r.trigger !== trigger);
                      return { ...c, escalation: { ...c.escalation, rules } };
                    })
                  }
                />
              );
            })}
          </div>
        </Field>
        {keywordRule && (
          <TextInput
            label={t('agent.escalation.keywords')}
            value={(keywordRule.keywords ?? []).join(', ')}
            disabled={disabled}
            errors={errors}
            path={`escalation.rules.${config.escalation.rules.indexOf(keywordRule)}.keywords`}
            onChange={(v) =>
              set((c) => ({
                ...c,
                escalation: {
                  ...c.escalation,
                  rules: c.escalation.rules.map((r) =>
                    r.trigger === 'keyword'
                      ? {
                          ...r,
                          keywords: v
                            .split(',')
                            .map((k) => k.trim())
                            .filter((k) => k.length > 0),
                        }
                      : r,
                  ),
                },
              }))
            }
          />
        )}
        <TextAreaInput
          label={t('agent.escalation.handoffMessage')}
          hint={t('agent.escalation.handoffHint')}
          value={config.escalation.handoffMessage}
          disabled={disabled}
          errors={errors}
          path="escalation.handoffMessage"
          rows={2}
          onChange={(v) =>
            set((c) => ({ ...c, escalation: { ...c.escalation, handoffMessage: v } }))
          }
        />
      </Section>

      <Separator />

      {/* ── Guardrails ──────────────────────────────────────────────────────── */}
      <Section title={t('agent.sections.guardrails')}>
        <TextAreaInput
          label={t('agent.guardrails.forbiddenTopics')}
          hint={t('agent.guardrails.forbiddenHint')}
          value={config.guardrails.forbiddenTopics.join('\n')}
          disabled={disabled}
          errors={errors}
          path="guardrails.forbiddenTopics"
          onChange={(v) =>
            set((c) => ({ ...c, guardrails: { ...c.guardrails, forbiddenTopics: linesToArray(v) } }))
          }
        />
        <TextAreaInput
          label={t('agent.guardrails.custom')}
          hint={t('agent.guardrails.customHint')}
          value={config.guardrails.custom.join('\n')}
          disabled={disabled}
          errors={errors}
          path="guardrails.custom"
          onChange={(v) =>
            set((c) => ({ ...c, guardrails: { ...c.guardrails, custom: linesToArray(v) } }))
          }
        />
      </Section>
    </div>
  );
}
