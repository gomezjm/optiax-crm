/**
 * Configurator ↔ AgentConfigSchema round-trip (ws-d3 §7): the invariants the
 * wizard relies on — the capture picker only offers resolvable keys, the
 * outside_hours/schedule rule is enforced, and a config edited the way the form
 * edits it still validates. Plus a carry-over regression on the customers label.
 */
import { describe, expect, it } from 'vitest';
import { CaptureFieldSchema, validateAgentConfig, type AgentConfig } from '@optiax/shared';
import { buildCaptureOptions } from '../../src/lib/agent/capture-fields';
import { t } from '../../src/i18n/index';

function baseConfig(): AgentConfig {
  const result = validateAgentConfig({
    version: 1,
    business: { name: 'Moda Valentina', description: 'Boutique de ropa.', vertical: 'retail' },
    agent: {
      displayName: 'Vale',
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
    orders: { enabled: true, confirmBeforeCreate: true, collectDelivery: false, sharePaymentMethods: false },
    escalation: { rules: [], handoffMessage: 'Te paso con el equipo.' },
    guardrails: { forbiddenTopics: [], custom: [] },
  });
  if (!result.ok) throw new Error('base config invalid');
  return result.config;
}

describe('capture picker options', () => {
  it('offers core columns plus enabled attribute_defs, and every key is a valid capture key', () => {
    const options = buildCaptureOptions([
      { key: 'talla', label: 'Talla' },
      { key: 'color_favorito', label: 'Color favorito' },
    ]);
    const keys = options.map((o) => o.key);
    expect(keys).toContain('name');
    expect(keys).toContain('city');
    expect(keys).toContain('talla');
    // Every offered key resolves as a valid CaptureFieldSchema key.
    for (const key of keys) {
      expect(CaptureFieldSchema.safeParse({ key, required: false }).success).toBe(true);
    }
  });

  it('lets a core column win over a colliding attribute key', () => {
    const options = buildCaptureOptions([{ key: 'city', label: 'Ciudad (custom)' }]);
    const cityOptions = options.filter((o) => o.key === 'city');
    expect(cityOptions).toHaveLength(1);
    expect(cityOptions[0]?.kind).toBe('core');
  });

  it('a config built from picked keys still validates', () => {
    const options = buildCaptureOptions([{ key: 'talla', label: 'Talla' }]);
    const config: AgentConfig = {
      ...baseConfig(),
      capture: { fields: options.slice(0, 3).map((o) => ({ key: o.key, required: false })) },
    };
    expect(validateAgentConfig(config).ok).toBe(true);
  });
});

describe('outside_hours requires a schedule (R1 §8.2)', () => {
  it('rejects outside_hours with no schedule and points at agent.schedule', () => {
    const config = baseConfig();
    const invalid = { ...config, agent: { ...config.agent, operatingMode: 'outside_hours' as const } };
    const result = validateAgentConfig(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.path === 'agent.schedule')).toBe(true);
  });

  it('accepts it once a schedule is added (what the form seeds)', () => {
    const config = baseConfig();
    const valid = {
      ...config,
      agent: {
        ...config.agent,
        operatingMode: 'outside_hours' as const,
        schedule: { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' },
      },
    };
    expect(validateAgentConfig(valid).ok).toBe(true);
  });
});

describe('carry-over 0.2 regression', () => {
  it('labels the customers metric "Total en pedidos"', () => {
    expect(t('customers.columns.totalSpent')).toBe('Total en pedidos');
    expect(t('customers.filters.totalSpent')).toBe('Total en pedidos');
  });
});
