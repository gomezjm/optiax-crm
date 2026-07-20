/**
 * Shared shapes for tool execution (ws-r2 §3).
 *
 * The load-bearing rule lives in `ToolContext`: `tenantId` and the ids that go
 * with it are bound here, from the loop, and never read from model arguments.
 * An executor is handed the repo already scoped to the tenant, so there is no
 * code path where a forged `tenant_id` in the model's JSON could reach a query.
 */
import type { AgentConfig, Json } from '@optiax/shared';
import type { TenantRepo } from '../db/index.js';

export interface ToolContext {
  repo: TenantRepo;
  config: AgentConfig;
  /** Bound from the conversation being processed, never from model args. */
  conversationId: string;
  /** The tenant's currency for new orders (`tenants.currency`). */
  currency: string;
  log: (message: string) => void;
}

/**
 * The outcome of one tool run, handed back to the model verbatim.
 *
 * `ok: false` is a normal, expected result — bad arguments, an unavailable
 * product, a tool that isn't offered. The model reads it and recovers
 * (asks a clarifying question, offers an alternative). Executors never throw
 * for these; a throw means the *infrastructure* failed and the queue should
 * retry the whole message.
 */
export type ToolOutcome =
  | { ok: true; result: Json; stopLoop?: boolean; reply?: string }
  | { ok: false; error: string; details?: Json };

export interface ToolExecutor {
  (args: Json, ctx: ToolContext): Promise<ToolOutcome>;
}
