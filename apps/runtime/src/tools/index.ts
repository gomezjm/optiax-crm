/**
 * Tool registry + the bounded model/tool loop (ws-r2 §2).
 *
 * The loop is deliberately small and deliberately bounded. A model that keeps
 * calling tools forever is not a hypothetical — a confused agent will happily
 * re-check the catalog until something stops it, and every round costs a real
 * API call against a real customer waiting on WhatsApp.
 */
import type { AgentToolName, Json } from '@optiax/shared';
import { AGENT_TOOL_NAMES } from '@optiax/shared';
import type {
  AgentModel,
  GenerateReplyInput,
  ModelHistoryEntry,
  ModelUsage,
  ToolCall,
  ToolDeclaration,
  ToolResult,
} from '../model/types.js';
import { captureCustomer, checkCatalog, createOrder, handoffToHuman } from './executors.js';
import type { ToolContext, ToolExecutor, ToolOutcome } from './types.js';

export { buildToolDeclarations, TOOL_ARG_SCHEMAS } from './declarations.js';
export type { DeclarationContext } from './declarations.js';
export type { ToolContext, ToolOutcome } from './types.js';

/** Hard ceiling on model calls per inbound message (ws-r2 §2.4). */
export const MAX_MODEL_ROUNDS = 4;

const EXECUTORS: Record<AgentToolName, ToolExecutor> = {
  check_catalog: checkCatalog,
  capture_customer: captureCustomer,
  create_order: createOrder,
  handoff_to_human: handoffToHuman,
};

function isKnownToolName(name: string): name is AgentToolName {
  return (AGENT_TOOL_NAMES as readonly string[]).includes(name);
}

/**
 * Run one tool call. A call for a tool this tenant was not offered is rejected
 * without executing: the declarations are the contract, and a model that asks
 * for something outside them is confused or being steered.
 */
export async function executeToolCall(
  call: ToolCall,
  offered: ToolDeclaration[],
  ctx: ToolContext,
): Promise<ToolOutcome> {
  if (!isKnownToolName(call.name)) {
    ctx.log(`[tool] rejected unknown tool "${call.name}"`);
    return { ok: false, error: 'unknown_tool', details: { name: call.name } };
  }
  if (!offered.some((tool) => tool.name === call.name)) {
    ctx.log(`[tool] rejected "${call.name}" — not offered for this tenant`);
    return { ok: false, error: 'tool_not_available', details: { name: call.name } };
  }
  return EXECUTORS[call.name](call.args, ctx);
}

function toToolResult(call: ToolCall, outcome: ToolOutcome): ToolResult {
  return {
    name: call.name,
    ok: outcome.ok,
    result: outcome.ok
      ? outcome.result
      : ({ error: outcome.error, ...(outcome.details !== undefined ? { details: outcome.details } : {}) } as Json),
  };
}

/** One completed model round, recorded as an `agent_turns` row by the caller. */
export interface LoopRound {
  usage: ModelUsage;
  /** `tool_calls` jsonb: what the model asked for and what it got back. */
  toolCalls: Json;
}

export interface RunToolLoopResult {
  /** The text to send the customer, or null when no round produced one. */
  text: string | null;
  rounds: LoopRound[];
  /** True when the loop ended because a tool said so (handoff). */
  stoppedByTool: boolean;
  /** True when MAX_MODEL_ROUNDS was reached with the model still calling tools. */
  hitRoundLimit: boolean;
}

export interface RunToolLoopInput {
  model: AgentModel;
  systemPrompt: string;
  history: ModelHistoryEntry[];
  tools: ToolDeclaration[];
  ctx: ToolContext;
}

/**
 * Drive model → tools → model until the model produces prose, a tool ends the
 * conversation, or we hit the round ceiling.
 *
 * Every round becomes an `agent_turns` row (with `tool_calls` populated), so
 * token and latency accounting stays cumulative and R3's evals have the whole
 * trace to assert on rather than just the final message.
 */
export async function runToolLoop(input: RunToolLoopInput): Promise<RunToolLoopResult> {
  const { model, systemPrompt, history, tools, ctx } = input;
  const rounds: LoopRound[] = [];
  const toolTurns: NonNullable<GenerateReplyInput['toolTurns']> = [];

  for (let round = 0; round < MAX_MODEL_ROUNDS; round++) {
    const reply = await model.generateReply({
      systemPrompt,
      history,
      ...(tools.length > 0 ? { tools } : {}),
      ...(toolTurns.length > 0 ? { toolTurns } : {}),
    });
    const usage: ModelUsage = {
      model: reply.model,
      inputTokens: reply.inputTokens,
      outputTokens: reply.outputTokens,
      latencyMs: reply.latencyMs,
    };

    if (reply.kind === 'text') {
      rounds.push({ usage, toolCalls: [] });
      return { text: reply.text, rounds, stoppedByTool: false, hitRoundLimit: false };
    }

    const calls = reply.toolCalls;
    const results: ToolResult[] = [];
    let stopText: string | null = null;
    let stopped = false;

    for (const call of calls) {
      const outcome = await executeToolCall(call, tools, ctx);
      results.push(toToolResult(call, outcome));
      if (outcome.ok && outcome.stopLoop) {
        stopped = true;
        stopText = outcome.reply ?? null;
        // Remaining calls in the same batch are dropped: after a handoff the
        // conversation belongs to a human, and running more writes against it
        // would be the bot acting after it was told to stop.
        break;
      }
    }

    rounds.push({
      usage,
      toolCalls: calls.map((call, i) => ({
        name: call.name,
        args: call.args,
        result: results[i]?.result ?? null,
        ok: results[i]?.ok ?? false,
      })) as Json,
    });
    toolTurns.push({ calls, results });

    if (stopped) {
      return { text: stopText, rounds, stoppedByTool: true, hitRoundLimit: false };
    }
  }

  // Ceiling reached and the model is still calling tools. Nothing it produced
  // is a message to the customer, so the caller falls back.
  ctx.log(`[tool] hit ${MAX_MODEL_ROUNDS}-round ceiling without a text reply`);
  return { text: null, rounds, stoppedByTool: false, hitRoundLimit: true };
}
