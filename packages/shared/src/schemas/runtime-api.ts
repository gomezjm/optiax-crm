/**
 * The one genuine frontend→backend contract (architecture doc §2, ws-d3 §1–§2):
 * the dashboard's Playground and Publish flows call the runtime with the user's
 * Supabase access token, and these are the request/response shapes they share.
 *
 * Types live here so the runtime endpoint and the dashboard client type against
 * one definition — no drift on the single place the two ends actually meet.
 * Zod for the request (the runtime re-validates untrusted input); plain types
 * for responses (the runtime constructs them, the dashboard renders them).
 */
import { z } from 'zod';
import type { Json } from '../db-types.js';
import type { EvalRunResult } from './eval.js';
import { AgentConfigSchema } from './agent-config.js';

/** Cap on a single chat message — the Playground is a test surface, not a paste bin. */
const MESSAGE_MAX = 4000;

/** One prior turn in the simulated conversation. Roles map to model history entries. */
export const PlaygroundMessageSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    text: z.string().trim().min(1).max(MESSAGE_MAX),
  })
  .strict();

export type PlaygroundMessage = z.infer<typeof PlaygroundMessageSchema>;

/**
 * POST /playground body. The draft `config` rides in the request (unpublished,
 * so it is not on the server yet) and is re-validated with AgentConfigSchema by
 * the runtime; `messages` is the conversation so far and `newMessage` the turn
 * to answer.
 */
export const PlaygroundRequestSchema = z
  .object({
    config: AgentConfigSchema,
    messages: z.array(PlaygroundMessageSchema).max(50).default([]),
    newMessage: z.string().trim().min(1).max(MESSAGE_MAX),
  })
  .strict();

export type PlaygroundRequest = z.infer<typeof PlaygroundRequestSchema>;

/** One tool the agent invoked during the simulated turn, with its outcome. */
export interface PlaygroundToolCall {
  name: string;
  args: Json;
  /** The executor's result payload (or its structured error when `ok` is false). */
  result: Json;
  ok: boolean;
}

/** One model round of the loop: the tools it called that round (empty on the text round). */
export interface PlaygroundTurn {
  toolCalls: PlaygroundToolCall[];
}

/**
 * POST /playground response. `reply` is what the agent would say; `toolCalls` is
 * every tool action across the loop (what it *would do* — none of it persisted);
 * `turns` preserves per-round grouping for a detailed view; `handoff` is true
 * when the turn escalated to a human (explicit handoff or the round ceiling).
 */
export interface PlaygroundResponse {
  reply: string;
  toolCalls: PlaygroundToolCall[];
  turns: PlaygroundTurn[];
  handoff: boolean;
}

/**
 * POST /publish response. On a passing gate the draft is compiled and published
 * and the new version id comes back; on a failing gate nothing is written and
 * the per-case evaluation explains what broke. POST /publish/evaluate returns
 * the bare `EvalRunResult` (a dry run — never writes).
 */
export type PublishResponse =
  | { published: true; versionId: string; compilerVersion: string; evaluation: EvalRunResult }
  | { published: false; reason: 'gate_failed'; evaluation: EvalRunResult };
