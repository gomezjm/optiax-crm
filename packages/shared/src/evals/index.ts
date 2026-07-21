/**
 * Eval suite registry (ws-r3 §3). Exposed via the `@optiax/shared/evals`
 * subpath (not the root barrel) so eval fixture data never reaches the
 * dashboard bundle. The runtime harness and hand-runs import from here.
 */
import type { EvalSuite } from '../schemas/eval.js';
import { retailSuite } from './retail.js';
import { foodSuite } from './food.js';

export { retailSuite } from './retail.js';
export { foodSuite } from './food.js';
export { RETAIL_CONFIG, FOOD_CONFIG } from './configs.js';

/** All suites keyed by vertical. */
export const EVAL_SUITES: Readonly<Record<string, EvalSuite>> = {
  retail: retailSuite,
  food: foodSuite,
};

/**
 * The suite for a vertical. Unknown verticals fall back to retail (the only
 * vertical with a dedicated compiler template today); callers that need to know
 * whether a suite is vertical-specific should check the key first.
 */
export function getEvalSuite(vertical: string): EvalSuite {
  return EVAL_SUITES[vertical] ?? retailSuite;
}
