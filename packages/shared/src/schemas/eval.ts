/**
 * Eval contracts (ws-r3 §2): the LLM-judge output schema, the conversation
 * fixture shape, and the result types the publish gate returns.
 *
 * These live in `packages/shared` so both the runtime harness and the future
 * dashboard publish UI (D3) type against one definition. Fixture DATA lives in
 * `@optiax/shared/evals`; only the TYPES and the judge schema live here.
 *
 * Everything is provider- and storage-agnostic: a scripted model turn is just
 * `{ name, args }` (structurally the runtime's ToolCall), and a deterministic
 * check is a small tagged union the harness interprets. No runtime or DB types
 * leak in.
 */
import { z } from 'zod';
import type { Json } from '../db-types.js';
import type { AgentConfig } from './agent-config.js';
import type { AgentToolName } from './agent-tools.js';

/**
 * The LLM-judge's structured verdict. Scores are 1–5 with a written rationale;
 * the gate thresholds them with a margin (judge scores vary run-to-run — see
 * spec §2), never on exact equality. Rationales are logged for D3's
 * "what broke" view.
 */
export const EvalJudgementSchema = z
  .object({
    score: z.number().int().min(1).max(5),
    rationale: z.string().trim().min(1).max(2000),
  })
  .strict();

export type EvalJudgement = z.infer<typeof EvalJudgementSchema>;

/** A product seeded into the eval's scratch catalog for a suite. */
export interface EvalCatalogProduct {
  /** Fixture-owned id; scripted create_order calls reference it directly. */
  id: string;
  name: string;
  description?: string;
  category?: string;
  price: number;
  promoPrice?: number | null;
  /** Defaults to true. Set false to seed an out-of-stock product. */
  available?: boolean;
}

/**
 * One scripted model turn for the deterministic (FakeModel) layer. Structurally
 * identical to the runtime's ScriptedTurn; the harness maps it 1:1. In the live
 * (real-Gemini) layer the script is ignored and the model decides.
 */
export type EvalScriptedTurn =
  | { kind: 'text'; text: string }
  | { kind: 'tool_calls'; toolCalls: { name: string; args: Json }[] };

/** A customer message. Images carry their caption as `body` (see toModelHistory). */
export interface EvalCustomerTurn {
  /** Defaults to 'text'. 'image' exercises the media path (Q-D probe). */
  type?: 'text' | 'image';
  body: string;
}

/**
 * A deterministic assertion the harness evaluates against the run outcome.
 * These gate publish — every one must pass for a non-probe case to pass.
 */
export type EvalCheck =
  | { kind: 'needs_attention'; value: boolean }
  | { kind: 'bot_paused'; value: boolean }
  | { kind: 'reply_sent'; value: boolean }
  | { kind: 'tool_called'; name: AgentToolName }
  | { kind: 'tool_not_called'; name: AgentToolName }
  | { kind: 'order_count'; value: number }
  | { kind: 'order_total'; value: number }
  | { kind: 'customer_field'; key: string; value: string }
  | { kind: 'turn_error'; reason: string };

/** Initial conversation state seeded before the first customer turn. */
export interface EvalConversationState {
  botPaused?: boolean;
  /** Minutes from now until the pause lifts; null (with botPaused) = indefinite. */
  pausedUntilMinutes?: number | null;
  /** Age of the last customer message, for the 24h-window guard scenarios. */
  lastCustomerMessageAtHoursAgo?: number;
  needsAttention?: boolean;
  /** Q-D: seed an order in status kind='awaiting_payment' on the conversation. */
  openAwaitingPaymentOrder?: boolean;
}

/** Which parked R2 question a probe fixture measures (measured live, not gated). */
export type EvalProbe = 'quote_recall' | 'payment_escalation';

/** A canned conversation: turns + scripted model + expected outcomes + rubric. */
export interface ConversationFixture {
  id: string;
  vertical: string;
  title: string;
  description: string;
  state?: EvalConversationState;
  customerTurns: EvalCustomerTurn[];
  /** Scripted model behavior for the deterministic layer. */
  script: EvalScriptedTurn[];
  /** Deterministic assertions — gate publish. */
  checks: EvalCheck[];
  /** LLM-judge rubric and pass threshold (score >= threshold). */
  rubric: { prompt: string; threshold: number };
  /**
   * Skip the LLM-judge for this case: scenarios whose only outbound is a fixed
   * handoff message or nothing at all (pause, outside-window, runaway) carry no
   * model prose worth scoring. Deterministic checks still gate.
   */
  skipJudge?: boolean;
  /**
   * Marks a probe (Q-C/Q-D): its checks are recorded as observations in the
   * live layer for probe-rate reporting, never gated. Omitted for gate cases.
   */
  probe?: EvalProbe;
}

/** A vertical's suite: one scratch catalog + reference config + fixtures. */
export interface EvalSuite {
  vertical: string;
  /**
   * The known-good reference config for this vertical. Hand-runs and the
   * "seeded good config passes" gate test evaluate against this; `evaluateDraft`
   * substitutes the tenant's draft so the same scenarios test the candidate.
   */
  config: AgentConfig;
  catalog: EvalCatalogProduct[];
  fixtures: ConversationFixture[];
}

// ── Result types (returned by evaluateDraft; D3 renders them) ────────────────

export interface EvalCheckResult {
  check: EvalCheck;
  pass: boolean;
  detail?: string;
}

export interface EvalCaseResult {
  fixtureId: string;
  title: string;
  probe?: EvalProbe;
  /** All deterministic checks passed. */
  deterministicPass: boolean;
  checks: EvalCheckResult[];
  /** Null when the judge was not run (e.g. deterministic layer stub disabled). */
  judgement: EvalJudgement | null;
  /** Judge score cleared the fixture threshold (true when no judge ran). */
  judgePass: boolean;
  threshold: number;
  tokens: { input: number; output: number };
  transcript: { role: string; text: string }[];
}

export interface EvalRunResult {
  /** Publish gate: every non-probe case passed deterministic checks + judge threshold. */
  pass: boolean;
  vertical: string;
  cases: EvalCaseResult[];
}
