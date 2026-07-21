/**
 * The publish gate (ws-r3 §4).
 *
 * `evaluateDraft(tenantId)` is what D3's publish button calls: it loads the
 * tenant's draft config, runs that vertical's suite against the REAL pipeline,
 * and returns per-case results. Publish is blocked unless every non-probe case
 * passes its deterministic checks AND clears the judge threshold. Probes (Q-C,
 * Q-D) are measured, never gated.
 *
 * Two layers share one core (`evaluateSuite`):
 *   - deterministic (default gate, `pnpm test`): FakeModel scripted turns + a
 *     stub judge. Fast, no network. This is what blocks a bad publish.
 *   - live (`pnpm eval:live`): real Gemini for both the agent and the judge.
 *
 * The core is DB-pluggable: `evaluateDraft` uses the runtime db only to LOAD the
 * draft config; each fixture runs against a fresh in-memory EvalDb, so the gate
 * never mutates the tenant's real data.
 */
import { getEvalSuite } from '@optiax/shared/evals';
import type {
  AgentConfig,
  ConversationFixture,
  EvalCaseResult,
  EvalRunResult,
  EvalSuite,
} from '@optiax/shared';
import type { AgentModel } from '../model/types.js';
import { FakeModel, type ScriptedTurn } from '../model/fake.js';
import { createDb, type RuntimeDb } from '../db/index.js';
import { loadEnv } from '../env.js';
import { runFixture } from './harness.js';

export interface EvaluateOptions {
  /** Conversation model for a fixture. Deterministic: FakeModel(script); live: shared Gemini. */
  makeModel: (fixture: ConversationFixture) => AgentModel;
  /** Judge model (shared across cases). Omit to skip judging. */
  judgeModel?: AgentModel;
  /** Restrict to a subset of fixtures (e.g. only probes, or one id). */
  filter?: (fixture: ConversationFixture) => boolean;
  log?: (message: string) => void;
}

/** Run one suite against one config and compute the gate verdict. */
export async function evaluateSuite(
  suite: EvalSuite,
  config: AgentConfig,
  opts: EvaluateOptions,
): Promise<EvalRunResult> {
  const cases: EvalCaseResult[] = [];
  for (const fixture of suite.fixtures) {
    if (opts.filter && !opts.filter(fixture)) continue;
    const { result } = await runFixture({
      suite,
      fixture,
      config,
      model: opts.makeModel(fixture),
      ...(opts.judgeModel ? { judgeModel: opts.judgeModel } : {}),
      ...(opts.log ? { log: opts.log } : {}),
    });
    cases.push(result);
  }
  // Gate: non-probe cases must pass deterministic checks AND the judge threshold.
  const pass = cases.filter((c) => !c.probe).every((c) => c.deterministicPass && c.judgePass);
  return { pass, vertical: suite.vertical, cases };
}

/** The deterministic (FakeModel) layer: scripted agent + stub judge. Gates publish. */
export function deterministicOptions(overrides: Partial<EvaluateOptions> = {}): EvaluateOptions {
  return {
    makeModel: (fixture) => new FakeModel('Respuesta del agente.', fixture.script as ScriptedTurn[]),
    // A stub judge that always returns a passing verdict: the deterministic gate
    // relies on the checks, and judge scores are only meaningful with a real
    // model. This still exercises the judge plumbing + EvalJudgementSchema.
    judgeModel: new FakeModel('{"score": 5, "rationale": "deterministic stub"}'),
    ...overrides,
  };
}

/**
 * Evaluate a config directly (in-memory, no DB). The suite is chosen from
 * `config.business.vertical`. Defaults to the deterministic layer.
 */
export function evaluateConfig(
  config: AgentConfig,
  opts: EvaluateOptions = deterministicOptions(),
): Promise<EvalRunResult> {
  return evaluateSuite(getEvalSuite(config.business.vertical), config, opts);
}

export interface EvaluateDraftDeps {
  db?: RuntimeDb;
  options?: EvaluateOptions;
}

/**
 * The publish gate. Loads the tenant's draft config and runs its vertical's
 * suite through the deterministic layer. Throws if there is no draft to publish.
 */
export async function evaluateDraft(tenantId: string, deps: EvaluateDraftDeps = {}): Promise<EvalRunResult> {
  let db = deps.db;
  if (!db) {
    const env = loadEnv();
    db = createDb({ url: env.supabaseUrl, serviceRoleKey: env.supabaseServiceRoleKey });
  }
  const draft = await db.createTenantRepo(tenantId).getDraftConfig();
  if (!draft) throw new Error(`tenant ${tenantId} has no valid draft config to evaluate`);
  return evaluateSuite(getEvalSuite(draft.business.vertical), draft, deps.options ?? deterministicOptions());
}
