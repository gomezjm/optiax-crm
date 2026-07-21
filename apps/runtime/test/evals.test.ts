/**
 * Deterministic eval layer (ws-r3 §1, §4). Drives the real pipeline with
 * FakeModel scripted turns against a fresh in-memory EvalDb per fixture — no
 * network, so it runs in the default `pnpm test` gate.
 *
 * Proves the gate: the seeded good config passes both suites, and a
 * deliberately-broken draft fails.
 */
import { describe, expect, it } from 'vitest';
import { retailSuite, RETAIL_CONFIG, FOOD_CONFIG } from '@optiax/shared/evals';
import type { AgentConfig, EvalCaseResult } from '@optiax/shared';
import {
  evaluateConfig,
  evaluateSuite,
  evaluateDraft,
  deterministicOptions,
} from '../src/evals/index.js';
import { EvalDb } from '../src/evals/eval-db.js';
import { compilePrompt } from '@optiax/shared';

function caseById(cases: EvalCaseResult[], id: string): EvalCaseResult {
  const found = cases.find((c) => c.fixtureId === id);
  if (!found) throw new Error(`no case ${id}`);
  return found;
}

describe('publish gate — deterministic layer', () => {
  it('the seeded good retail config passes every gated case', async () => {
    const run = await evaluateConfig(RETAIL_CONFIG);
    expect(run.vertical).toBe('retail');
    expect(run.pass).toBe(true);
    // Every non-probe case passed deterministically.
    for (const c of run.cases.filter((x) => !x.probe)) {
      expect(c.deterministicPass, `${c.fixtureId}: ${JSON.stringify(c.checks.filter((k) => !k.pass))}`).toBe(true);
    }
  });

  it('the seeded good food config passes every gated case', async () => {
    const run = await evaluateConfig(FOOD_CONFIG);
    expect(run.vertical).toBe('food');
    expect(run.pass).toBe(true);
    for (const c of run.cases.filter((x) => !x.probe)) {
      expect(c.deterministicPass, `${c.fixtureId}: ${JSON.stringify(c.checks.filter((k) => !k.pass))}`).toBe(true);
    }
  });

  it('blocks a deliberately-broken draft (orders disabled → happy path fails)', async () => {
    const broken: AgentConfig = { ...RETAIL_CONFIG, orders: { ...RETAIL_CONFIG.orders, enabled: false } };
    const run = await evaluateSuite(retailSuite, broken, deterministicOptions());
    expect(run.pass).toBe(false);
    // The happy path could not create the order.
    const happy = caseById(run.cases, 'retail-happy-capture-order');
    expect(happy.deterministicPass).toBe(false);
    expect(happy.checks.find((c) => c.check.kind === 'order_count')?.pass).toBe(false);
  });

  it('blocks a broken draft that drops a required capture field', async () => {
    const broken: AgentConfig = {
      ...RETAIL_CONFIG,
      capture: { fields: RETAIL_CONFIG.capture.fields.filter((f) => f.key !== 'barrio_entrega') },
    };
    const run = await evaluateSuite(retailSuite, broken, deterministicOptions());
    expect(run.pass).toBe(false);
    const happy = caseById(run.cases, 'retail-happy-capture-order');
    // The barrio_entrega attribute was rejected (not a configured field).
    expect(happy.checks.find((c) => c.check.kind === 'customer_field' && (c.check as { key: string }).key === 'barrio_entrega')?.pass).toBe(false);
  });
});

describe('scenario outcomes (real pipeline behavior)', () => {
  it('happy path creates one order priced from the catalog', async () => {
    const run = await evaluateConfig(RETAIL_CONFIG);
    const happy = caseById(run.cases, 'retail-happy-capture-order');
    expect(happy.checks.find((c) => c.check.kind === 'order_total')?.pass).toBe(true);
    expect(happy.checks.find((c) => c.check.kind === 'order_count')?.pass).toBe(true);
  });

  it('escalation flips needs_attention and pauses', async () => {
    const run = await evaluateConfig(RETAIL_CONFIG);
    const esc = caseById(run.cases, 'retail-escalation-human-request');
    expect(esc.deterministicPass).toBe(true);
  });

  it('runaway loop hits the §0 round-limit handoff', async () => {
    const run = await evaluateConfig(RETAIL_CONFIG);
    const runaway = caseById(run.cases, 'retail-runaway-handoff');
    expect(runaway.deterministicPass).toBe(true);
    expect(runaway.checks.find((c) => c.check.kind === 'turn_error')?.pass).toBe(true);
  });

  it('a paused conversation runs no tools and sends nothing', async () => {
    const run = await evaluateConfig(RETAIL_CONFIG);
    const paused = caseById(run.cases, 'retail-pause-no-tools');
    expect(paused.deterministicPass).toBe(true);
  });

  it('out of stock never creates an order', async () => {
    const run = await evaluateConfig(RETAIL_CONFIG);
    const oos = caseById(run.cases, 'retail-out-of-stock');
    expect(oos.checks.find((c) => c.check.kind === 'order_count')?.pass).toBe(true);
    expect(oos.deterministicPass).toBe(true);
  });

  it('probes run but do not affect the gate verdict', async () => {
    const run = await evaluateConfig(RETAIL_CONFIG);
    const probes = run.cases.filter((c) => c.probe);
    expect(probes.length).toBeGreaterThanOrEqual(2);
  });
});

describe('LLM-judge plumbing (stub judge)', () => {
  it('produces a validated judgement for cases with a reply', async () => {
    const run = await evaluateConfig(RETAIL_CONFIG);
    const happy = caseById(run.cases, 'retail-happy-capture-order');
    expect(happy.judgement).not.toBeNull();
    expect(happy.judgement?.score).toBe(5);
    expect(happy.judgePass).toBe(true);
  });

  it('skips the judge for no-prose scenarios', async () => {
    const run = await evaluateConfig(RETAIL_CONFIG);
    const paused = caseById(run.cases, 'retail-pause-no-tools');
    expect(paused.judgement).toBeNull();
    expect(paused.judgePass).toBe(true);
  });
});

describe('evaluateDraft', () => {
  it('loads a draft config from the db and evaluates it', async () => {
    // A minimal RuntimeDb whose only job here is to hand back the draft config;
    // each fixture still runs against its own fresh in-memory EvalDb.
    const configSource = new EvalDb({
      vertical: 'retail',
      config: RETAIL_CONFIG,
      compiledPrompt: compilePrompt(RETAIL_CONFIG, { vertical: 'retail' }).prompt,
      currency: 'COP',
      timezone: 'America/Bogota',
      catalog: [],
    });
    const run = await evaluateDraft(configSource.tenantId, { db: configSource });
    expect(run.pass).toBe(true);
    expect(run.vertical).toBe('retail');
  });
});
