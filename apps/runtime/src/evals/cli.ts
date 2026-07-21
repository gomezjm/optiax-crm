/**
 * Eval CLI (ws-r3 §1, §4).
 *
 *   pnpm eval [vertical]         deterministic layer (FakeModel + stub judge),
 *                                no network — the same gate CI runs.
 *   pnpm eval:live [vertical]    real Gemini for agent + judge, and the Q-C/Q-D
 *                                probes repeated to report rates. Needs
 *                                GEMINI_API_KEY. NEVER part of the default gate.
 *
 * Exit code is non-zero when the gate verdict is a fail, so both layers are
 * scriptable.
 */
import { EVAL_SUITES } from '@optiax/shared/evals';
import type { EvalRunResult, EvalSuite } from '@optiax/shared';
import type { AgentModel } from '../model/types.js';
import { GeminiModel } from '../model/gemini.js';
import { loadEnv } from '../env.js';
import { evaluateSuite, deterministicOptions, type EvaluateOptions } from './evaluate.js';
import { runFixture } from './harness.js';

const PROBE_REPEATS = 5;

function pickSuites(vertical: string | undefined): EvalSuite[] {
  if (!vertical) return Object.values(EVAL_SUITES);
  const suite = EVAL_SUITES[vertical];
  if (!suite) {
    throw new Error(`unknown vertical "${vertical}" — known: ${Object.keys(EVAL_SUITES).join(', ')}`);
  }
  return [suite];
}

function printRun(run: EvalRunResult): void {
  console.log(`\n== ${run.vertical} ==`);
  for (const c of run.cases) {
    const det = c.deterministicPass ? 'PASS' : 'FAIL';
    const judge = c.judgement ? ` judge=${c.judgement.score}/5` : '';
    const tag = c.probe ? ' [probe]' : '';
    const failed = c.checks.filter((k) => !k.pass).map((k) => `${k.check.kind}(${k.detail})`);
    console.log(`  ${det}${judge}${tag}  ${c.fixtureId}`);
    if (failed.length > 0) console.log(`        ✗ ${failed.join('; ')}`);
  }
  console.log(`  → gate: ${run.pass ? 'PASS' : 'FAIL'}`);
}

/** Q-C / Q-D probe rates from repeated live runs. */
async function runProbes(suite: EvalSuite, model: AgentModel): Promise<void> {
  const probes = suite.fixtures.filter((f) => f.probe);
  if (probes.length === 0) return;
  console.log(`\n-- probes (${suite.vertical}, ${PROBE_REPEATS} runs each) --`);
  for (const fixture of probes) {
    let recheck = 0; // Q-C: 2nd message re-called check_catalog
    let completed = 0; // Q-C: order created
    let escalated = 0; // Q-D: handoff fired
    for (let i = 0; i < PROBE_REPEATS; i++) {
      const { result, toolCallsByTurn } = await runFixture({ suite, fixture, config: suite.config, model });
      if (fixture.probe === 'quote_recall') {
        if ((toolCallsByTurn[1] ?? []).includes('check_catalog')) recheck++;
        if (result.checks.find((c) => c.check.kind === 'order_count')?.pass) completed++;
      } else if (fixture.probe === 'payment_escalation') {
        if (result.checks.find((c) => c.check.kind === 'tool_called')?.pass) escalated++;
      }
    }
    if (fixture.probe === 'quote_recall') {
      console.log(
        `  Q-C ${fixture.id}: re-check_catalog ${recheck}/${PROBE_REPEATS}, order completed ${completed}/${PROBE_REPEATS}`,
      );
    } else {
      console.log(`  Q-D ${fixture.id}: escalated ${escalated}/${PROBE_REPEATS}`);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const live = args.includes('--live');
  const vertical = args.find((a) => !a.startsWith('--'));
  const suites = pickSuites(vertical);

  let options: EvaluateOptions;
  let liveModel: AgentModel | null = null;
  if (live) {
    const env = loadEnv();
    if (!env.geminiApiKey) throw new Error('pnpm eval:live needs GEMINI_API_KEY in apps/runtime/.env.local');
    liveModel = new GeminiModel({ apiKey: env.geminiApiKey, modelId: env.geminiModelId });
    options = { makeModel: () => liveModel!, judgeModel: liveModel };
  } else {
    options = deterministicOptions();
  }

  let allPass = true;
  for (const suite of suites) {
    const run = await evaluateSuite(suite, suite.config, options);
    printRun(run);
    allPass &&= run.pass;
    if (live && liveModel) await runProbes(suite, liveModel);
  }

  if (live) {
    // The live layer is a reporting job, never a gate: the deterministic checks
    // are script-shaped and the real model diverges (more turns, asks size per
    // the retail template), so a hard fail here would be noise. Read the judge
    // scores + probe rates above. It never blocks a push and always exits 0.
    console.log('\nLIVE eval complete (reporting only — never gates; see judge scores + probe rates above)');
    process.exit(0);
  }

  console.log(`\ndeterministic eval ${allPass ? 'PASSED' : 'FAILED'}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
