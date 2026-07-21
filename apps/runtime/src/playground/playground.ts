/**
 * Playground runner (ws-d3 §1). Compiles the draft config in-memory and drives
 * the REAL R2 tool loop against a non-persisting context, returning what the
 * agent would say and what it would do — without writing anything.
 *
 * Deliberately calls `runToolLoop` directly rather than `processWebhookEvent`:
 * the Playground is not an inbound WhatsApp message (no dedupe, no 24h window,
 * no persistence), it is "run one turn of the loop and show me the trace." The
 * loop and executors are reused verbatim; only the repo is swapped for the
 * ephemeral one.
 */
import { compilePrompt, type AgentConfig } from '@optiax/shared';
import type { Json, PlaygroundResponse, PlaygroundToolCall, PlaygroundTurn } from '@optiax/shared';
import type { RuntimeDb } from '../db/index.js';
import type { AgentModel, ModelHistoryEntry } from '../model/types.js';
import { buildToolDeclarations, runToolLoop } from '../tools/index.js';
import { createPlaygroundRepo } from './playground-repo.js';

/** Synthetic conversation id bound into the loop context (never a real row). */
const PLAYGROUND_CONVERSATION_ID = 'playground';

export interface PlaygroundDeps {
  db: RuntimeDb;
  /** The conversation model (real Gemini in prod; FakeModel in tests). */
  model: AgentModel;
  log?: (message: string) => void;
}

export interface PlaygroundInput {
  config: AgentConfig;
  messages: { role: 'user' | 'assistant'; text: string }[];
  newMessage: string;
}

/** Normalize one round's `tool_calls` jsonb into typed PlaygroundToolCalls. */
function toToolCalls(raw: Json): PlaygroundToolCall[] {
  if (!Array.isArray(raw)) return [];
  const calls: PlaygroundToolCall[] = [];
  for (const entry of raw) {
    if (entry && typeof entry === 'object' && !Array.isArray(entry) && typeof entry.name === 'string') {
      calls.push({
        name: entry.name,
        args: entry.args ?? null,
        result: entry.result ?? null,
        ok: entry.ok === true,
      });
    }
  }
  return calls;
}

export async function runPlayground(
  deps: PlaygroundDeps,
  tenantId: string,
  input: PlaygroundInput,
): Promise<PlaygroundResponse> {
  const log = deps.log ?? (() => {});
  const real = deps.db.createTenantRepo(tenantId);
  const meta = await real.getTenantMeta();
  const { repo, buffer } = createPlaygroundRepo(real, tenantId);

  // Compile with the tenant's vertical (matches seed-auth / publish), not any
  // free-text vertical the config might carry.
  const compiled = compilePrompt(input.config, { vertical: meta.vertical });

  const history: ModelHistoryEntry[] = [
    ...input.messages.map((m) => ({ role: m.role, text: m.text })),
    { role: 'user' as const, text: input.newMessage },
  ];

  const tools = buildToolDeclarations(input.config, { hasProducts: await repo.hasAnyProduct() });

  const loop = await runToolLoop({
    model: deps.model,
    systemPrompt: compiled.prompt,
    history,
    tools,
    ctx: {
      repo,
      config: input.config,
      conversationId: PLAYGROUND_CONVERSATION_ID,
      currency: meta.currency,
      log,
    },
  });

  const turns: PlaygroundTurn[] = loop.rounds.map((round) => ({
    toolCalls: toToolCalls(round.toolCalls),
  }));
  const toolCalls = turns.flatMap((t) => t.toolCalls);

  // Same fallback the pipeline uses: a ceiling-hit turn has no prose, so send
  // the configured handoff message.
  const reply =
    loop.text ?? (loop.hitRoundLimit ? input.config.escalation.handoffMessage : '');
  const handoff = loop.hitRoundLimit || loop.stoppedByTool || buffer.needsAttention;

  return { reply, toolCalls, turns, handoff };
}
