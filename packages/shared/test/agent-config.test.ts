import { describe, expect, it } from 'vitest';
import { AgentConfigSchema, validateAgentConfig } from '../src/schemas/agent-config.js';
import { fullConfig, minimalConfig } from './fixtures/agent-configs.js';

describe('AgentConfigSchema', () => {
  it('parses a minimal config and applies defaults', () => {
    const parsed = AgentConfigSchema.parse(minimalConfig);
    expect(parsed.agent.pauseHoursOnOwnerReply).toBe(24);
    expect(parsed.faqs).toEqual([]);
    expect(parsed.capture.fields).toEqual([]);
    expect(parsed.guardrails).toEqual({ forbiddenTopics: [], custom: [] });
    expect(parsed.escalation.rules).toEqual([]);
  });

  it('parses a fully-populated config', () => {
    const parsed = AgentConfigSchema.parse(fullConfig);
    expect(parsed.agent.schedule?.days).toEqual([1, 2, 3, 4, 5, 6]);
    expect(parsed.faqs).toHaveLength(2);
  });

  it('rejects unknown keys everywhere (.strict())', () => {
    const result = AgentConfigSchema.safeParse({ ...minimalConfig, extra: true });
    expect(result.success).toBe(false);

    const nested = AgentConfigSchema.safeParse({
      ...minimalConfig,
      business: { ...minimalConfig.business, website: 'https://x.co' },
    });
    expect(nested.success).toBe(false);
  });

  // Both schedule-relative modes need one: "outside" of an undefined schedule
  // is meaningless (ws-r1 §8.2).
  it.each(['schedule', 'outside_hours'] as const)(
    "requires schedule when operatingMode is '%s'",
    (operatingMode) => {
      const result = AgentConfigSchema.safeParse({
        ...minimalConfig,
        agent: { ...minimalConfig.agent, operatingMode },
      });
      expect(result.success).toBe(false);
      expect(
        result.success ? [] : result.error.issues.map((i) => i.path.join('.')),
      ).toContain('agent.schedule');
    },
  );

  it.each(['schedule', 'outside_hours'] as const)(
    "accepts operatingMode '%s' when a schedule is present",
    (operatingMode) => {
      const result = AgentConfigSchema.safeParse({
        ...minimalConfig,
        agent: {
          ...minimalConfig.agent,
          operatingMode,
          schedule: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' },
        },
      });
      expect(result.success).toBe(true);
    },
  );

  it("requires keywords when an escalation trigger is 'keyword'", () => {
    const result = AgentConfigSchema.safeParse({
      ...minimalConfig,
      escalation: {
        handoffMessage: 'Te comunico con el equipo.',
        rules: [{ trigger: 'keyword' }],
      },
    });
    expect(result.success).toBe(false);
  });

  it('caps free-text lengths (FAQ answer ≤ 500 chars)', () => {
    const result = AgentConfigSchema.safeParse({
      ...minimalConfig,
      faqs: [{ q: 'x', a: 'a'.repeat(501) }],
    });
    expect(result.success).toBe(false);
  });

  it('validateAgentConfig returns structured path+message errors', () => {
    const result = validateAgentConfig({
      ...minimalConfig,
      agent: { ...minimalConfig.agent, tone: 'sarcastic' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      const tonesError = result.errors.find((e) => e.path === 'agent.tone');
      expect(tonesError).toBeDefined();
      expect(typeof tonesError?.message).toBe('string');
    }
  });

  it('validateAgentConfig returns the parsed config on success', () => {
    const result = validateAgentConfig(minimalConfig);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.business.name).toBe('Tienda Prueba');
    }
  });
});
