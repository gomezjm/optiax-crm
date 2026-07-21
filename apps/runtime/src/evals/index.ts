/**
 * Eval harness public surface (ws-r3). D3 wires its publish button to
 * `evaluateDraft`; hand-runs and the CLI use `evaluateConfig`/`evaluateSuite`.
 */
export {
  evaluateDraft,
  evaluateConfig,
  evaluateSuite,
  deterministicOptions,
  type EvaluateOptions,
  type EvaluateDraftDeps,
} from './evaluate.js';
export { runFixture, type RunFixtureInput, type RunFixtureResult } from './harness.js';
export { judgeTranscript, type JudgeResult } from './judge.js';
export { EvalDb, type EvalDbSeed } from './eval-db.js';
