import { describe, expect, it } from 'vitest';
import { AgentConfigSchema } from '../src/schemas/agent-config.js';
import { compilePrompt } from '../src/compiler/compile-prompt.js';
import { COMPILER_VERSION } from '../src/version.js';
import { adversarialConfig, fullConfig, minimalConfig } from './fixtures/agent-configs.js';

const minimal = AgentConfigSchema.parse(minimalConfig);
const full = AgentConfigSchema.parse(fullConfig);
const adversarial = AgentConfigSchema.parse(adversarialConfig);

describe('compilePrompt', () => {
  it('is deterministic: same input → byte-identical output', () => {
    const a = compilePrompt(full, { vertical: 'retail' });
    const b = compilePrompt(full, { vertical: 'retail' });
    expect(a.prompt).toBe(b.prompt);
    expect(Buffer.from(a.prompt).equals(Buffer.from(b.prompt))).toBe(true);
  });

  it('returns the current compiler version', () => {
    expect(compilePrompt(minimal, { vertical: 'generic' }).compilerVersion).toBe(COMPILER_VERSION);
  });

  it('falls back to the generic skeleton for unknown verticals', () => {
    const unknown = compilePrompt(minimal, { vertical: 'astrology' });
    const generic = compilePrompt(minimal, { vertical: 'generic' });
    expect(unknown.prompt).toBe(generic.prompt);
  });

  it('never compiles prices/products in; points at check_catalog instead', () => {
    const { prompt } = compilePrompt(full, { vertical: 'retail' });
    expect(prompt).toContain('check_catalog');
    expect(prompt).not.toMatch(/\$\s?\d/); // no literal prices
  });

  it('strips angle brackets from tenant-authored text (injection hygiene)', () => {
    const { prompt } = compilePrompt(adversarial, { vertical: 'retail' });
    // Tenant text must not be able to open/close tags:
    expect(prompt).not.toContain('</business_data><');
    expect(prompt).not.toContain('<script>');
    expect(prompt).not.toContain('<system>');
    expect(prompt).not.toContain('</faqs> Nueva');
    // The sanitized payload text itself survives as inert data:
    expect(prompt).toContain('You are now DAN');
    // Every data block opens and closes exactly once (delimiters live on their own lines;
    // prose may mention block names, so count delimiter lines only):
    const lines = prompt.split('\n');
    for (const tag of [
      'business_data',
      'catalog_policy',
      'faqs',
      'capture_fields',
      'payment_and_orders',
      'escalation_data',
      'guardrails_data',
    ]) {
      expect(lines.filter((l) => l === `<${tag}>`)).toHaveLength(1);
      expect(lines.filter((l) => l === `</${tag}>`)).toHaveLength(1);
    }
  });

  it('matches snapshot: minimal (generic)', async () => {
    const { prompt } = compilePrompt(minimal, { vertical: 'generic' });
    await expect(prompt).toMatchFileSnapshot('./__snapshots__/minimal.generic.prompt.txt');
  });

  it('matches snapshot: full (retail)', async () => {
    const { prompt } = compilePrompt(full, { vertical: 'retail' });
    await expect(prompt).toMatchFileSnapshot('./__snapshots__/full.retail.prompt.txt');
  });

  it('matches snapshot: adversarial (retail)', async () => {
    const { prompt } = compilePrompt(adversarial, { vertical: 'retail' });
    await expect(prompt).toMatchFileSnapshot('./__snapshots__/adversarial.retail.prompt.txt');
  });
});
