/**
 * Publish flow (ws-d3 §5) — the architecture doc's "automatic build".
 *
 * Two entry points, both reusing R3's gate:
 *   - runEvaluate: a dry run. Loads the tenant's draft and evaluates it via
 *     R3's `evaluateDraft`. Writes nothing. Backs POST /publish/evaluate so the
 *     dashboard can show "what would happen" before committing.
 *   - runPublish: gate → compile → flip. Loads the draft ONCE, evaluates that
 *     exact object (TOCTOU-safe: what we gate is what we publish), and only on a
 *     passing gate compiles it and calls the atomic `publish_agent_config` RPC.
 *     A failing gate publishes nothing and returns the per-case results.
 *
 * The model layer is injected (`EvaluateOptions`): real Gemini for the agent +
 * judge in the running service, the deterministic FakeModel layer in tests. The
 * deterministic assertions are what actually gate — a config that disables
 * orders makes `create_order` refuse, so the happy-path order check fails and
 * the gate blocks, regardless of which model drove the turn.
 */
import { compilePrompt } from '@optiax/shared';
import type { EvalRunResult, PublishResponse } from '@optiax/shared';
import type { RuntimeDb } from '../db/index.js';
import { evaluateConfig, evaluateDraft, type EvaluateOptions } from '../evals/evaluate.js';

export interface PublishDeps {
  db: RuntimeDb;
  /** Model layer for the gate. Live: real Gemini; tests: deterministicOptions(). */
  options: EvaluateOptions;
}

export class NoDraftError extends Error {
  constructor(tenantId: string) {
    super(`tenant ${tenantId} has no valid draft config`);
    this.name = 'NoDraftError';
  }
}

/** POST /publish/evaluate: evaluate the current draft, write nothing. */
export function runEvaluate(deps: PublishDeps, tenantId: string): Promise<EvalRunResult> {
  return evaluateDraft(tenantId, { db: deps.db, options: deps.options });
}

/** POST /publish: gate the draft, and on a pass compile + flip atomically. */
export async function runPublish(deps: PublishDeps, tenantId: string): Promise<PublishResponse> {
  const repo = deps.db.createTenantRepo(tenantId);

  // Load the exact object we will publish, then gate THAT — no re-read between
  // gate and compile.
  const draft = await repo.getDraftConfig();
  if (!draft) throw new NoDraftError(tenantId);

  const evaluation = await evaluateConfig(draft, deps.options);
  if (!evaluation.pass) {
    return { published: false, reason: 'gate_failed', evaluation };
  }

  const meta = await repo.getTenantMeta();
  const compiled = compilePrompt(draft, { vertical: meta.vertical });
  const { versionId } = await repo.publishConfig({
    config: draft,
    compiledPrompt: compiled.prompt,
    compilerVersion: compiled.compilerVersion,
    vertical: meta.vertical,
  });

  return { published: true, versionId, compilerVersion: compiled.compilerVersion, evaluation };
}
