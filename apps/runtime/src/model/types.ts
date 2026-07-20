/**
 * Provider-agnostic model interface (spec §2, extended for tools in ws-r2 §1).
 * The rest of the runtime never sees Gemini payload shapes — only this.
 */
import type { AgentToolName, Json } from '@optiax/shared';

export interface ModelHistoryEntry {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * A JSON-Schema-shaped parameter declaration, in the subset Gemini's
 * function-calling accepts: object types with flat-ish properties, no `$ref`,
 * no `anyOf` at the root. Hand-mapped from the shared Zod schemas — see
 * `src/tools/declarations.ts` for why, and the parity test that keeps the two
 * in step.
 */
export interface ToolParameterSchema {
  type: 'object';
  properties: Record<string, JsonSchemaNode>;
  required?: string[];
}

export interface JsonSchemaNode {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: string[];
  items?: JsonSchemaNode;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
}

export interface ToolDeclaration {
  name: AgentToolName;
  description: string;
  parameters: ToolParameterSchema;
}

/** A model's request to run one tool. `args` is unvalidated — executors parse it. */
export interface ToolCall {
  name: string;
  args: Json;
}

/**
 * What one tool run handed back, fed to the model on the next round. `ok`
 * distinguishes "the tool ran and here is the outcome" from "your call was
 * rejected"; both are data the model narrates or recovers from, never a throw.
 */
export interface ToolResult {
  name: string;
  ok: boolean;
  result: Json;
}

export interface GenerateReplyInput {
  systemPrompt: string;
  history: ModelHistoryEntry[];
  /** Omitted or empty → text-only turn, exactly the Phase 1 behavior. */
  tools?: ToolDeclaration[];
  /**
   * Tool rounds already completed this message, oldest first. Each entry is
   * the calls the model made and the results it got back.
   */
  toolTurns?: { calls: ToolCall[]; results: ToolResult[] }[];
}

export interface ModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

/**
 * A turn is either prose for the customer or a batch of tool calls — never
 * both. Gemini can technically return both; the adapter prefers tool calls and
 * drops any accompanying text, because sending prose that was written before
 * the tool ran would tell the customer something the tool may contradict.
 */
export type GenerateReplyResult = ModelUsage &
  ({ kind: 'text'; text: string } | { kind: 'tool_calls'; toolCalls: ToolCall[] });

export interface AgentModel {
  generateReply(input: GenerateReplyInput): Promise<GenerateReplyResult>;
}
