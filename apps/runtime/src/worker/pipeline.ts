/**
 * Per-webhook-event processing (phase-1 spec §1 + ws-r1). Resolve tenant →
 * dedupe → coexistence/policy checks → model reply → persist + send. Throwing
 * here means "retry me" — the worker's visibility-timeout/poison logic decides
 * what happens next. Terminal, non-retryable outcomes (unknown tenant,
 * malformed payload) mark the webhook_events row with an error and return
 * normally so the queue drains.
 *
 * ws-r1 additions: owner-echo handling sets the coexistence pause; pause
 * enforcement with lazy re-arm; operating hours; the 24h-window guard at the
 * send; every deliberate skip records an agent_turn with an AgentSkipReason
 * (when the tenant has an active prompt version — agent_turns.prompt_version_id
 * is NOT NULL, so without one the skip is console-only, same as Phase 1).
 */
import type { AgentConfig, AgentSkipReason } from '@optiax/shared';
import type { RuntimeDb, TenantContext, TenantRepo } from '../db/index.js';
import type { AgentModel } from '../model/types.js';
import { toModelHistory } from '../model/history.js';
import type { WaSender } from '../wa/sender.js';
import { parseEnvelope, type EchoWaMessage, type InboundWaMessage } from '../wa/envelope.js';
import { assertWithinWindow, OutsideWindowError } from '../wa/window.js';
import { buildToolDeclarations, runToolLoop } from '../tools/index.js';
import { isAgentActive } from './operating-hours.js';

export const HISTORY_LIMIT = 20;
/** Fallback when the published config is missing/invalid (schema default). */
export const DEFAULT_PAUSE_HOURS = 24;
/**
 * `agent_turns.error.reason` marker for a conversation handed off because the
 * tool loop hit the round ceiling (ws-r3 §0). Distinct from an AgentSkipReason:
 * tools ran, so this is not a skip — it records why the bot stopped and paused.
 */
export const ROUND_LIMIT_HANDOFF = 'round_limit_handoff';

export interface PipelineDeps {
  db: RuntimeDb;
  model: AgentModel;
  sender: WaSender;
  log?: (message: string) => void;
}

/** Published config, loaded lazily and cached for this event only (ws-r1 §1). */
type ConfigLoader = () => Promise<AgentConfig | null>;

export async function processWebhookEvent(deps: PipelineDeps, webhookEventId: string): Promise<void> {
  const { db, log = console.log } = deps;

  const event = await db.webhookEvents.get(webhookEventId);
  if (!event) {
    log(`[worker] webhook_event ${webhookEventId} not found — dropping`);
    return;
  }
  if (event.processed_at) return; // already handled (e.g. re-delivered queue message)

  const envelope = parseEnvelope(event.payload);
  if (!envelope.phoneNumberId) {
    await db.webhookEvents.markError(webhookEventId, { reason: 'no_phone_number_id' });
    return;
  }

  const tenant = await db.resolveTenantByPhoneNumberId(envelope.phoneNumberId);
  if (!tenant) {
    await db.webhookEvents.markError(webhookEventId, {
      reason: 'unknown_phone_number_id',
      phone_number_id: envelope.phoneNumberId,
    });
    return;
  }

  const repo = db.createTenantRepo(tenant.id);

  let configPromise: Promise<AgentConfig | null> | null = null;
  const getConfig: ConfigLoader = () => (configPromise ??= repo.getPublishedConfig());

  for (const status of envelope.statuses) {
    await repo.updateMessageWaStatus(status.waMessageId, status.status);
  }

  for (const echo of envelope.echoes) {
    await handleEchoMessage(deps, repo, echo, getConfig);
  }

  for (const message of envelope.messages) {
    await handleInboundMessage(deps, tenant, repo, message, getConfig);
  }

  await db.webhookEvents.markProcessed(webhookEventId);
}

/**
 * Owner replied from the WhatsApp Business app (ws-r1 §2): persist the message
 * (`outbound`/`owner_app`, idempotent on wa_message_id) and set/extend the
 * coexistence pause. Echoes move `last_message_at` only — they never open the
 * 24h window.
 */
async function handleEchoMessage(
  deps: PipelineDeps,
  repo: TenantRepo,
  echo: EchoWaMessage,
  getConfig: ConfigLoader,
): Promise<void> {
  const { log = console.log } = deps;

  const conversation = await repo.getOrCreateConversation(echo.to, null);

  const { message, wasDuplicate } = await repo.insertMessage({
    conversation_id: conversation.id,
    wa_message_id: echo.waMessageId,
    direction: 'outbound',
    source: 'owner_app',
    type: echo.type,
    body: echo.body,
  });

  if (!wasDuplicate) {
    await repo.updateConversationTimestamps(conversation.id, { lastMessageAt: message.created_at });
  } else if (conversation.bot_paused) {
    // Redelivered echo and the pause is already set — nothing to extend.
    return;
  }
  // wasDuplicate && !bot_paused falls through: retry after a mid-echo failure
  // (message row landed, pause didn't) — finish the job.

  if (conversation.bot_paused && conversation.paused_until === null) {
    // Indefinite pause (manual dashboard toggle) — an echo must never shorten
    // it to a finite window.
    log(`[worker] owner echo on indefinitely-paused conv=${conversation.id} — pause untouched`);
    return;
  }

  const config = await getConfig();
  const pauseHours = config?.agent.pauseHoursOnOwnerReply ?? DEFAULT_PAUSE_HOURS;
  if (!config) {
    log(`[worker] no valid published config — pausing with default ${DEFAULT_PAUSE_HOURS}h`);
  }
  const pausedUntil = new Date(Date.now() + pauseHours * 3_600_000).toISOString();
  await repo.setConversationPause(conversation.id, pausedUntil);
  log(`[worker] owner echo → bot paused conv=${conversation.id} until ${pausedUntil}`);
}

async function handleInboundMessage(
  deps: PipelineDeps,
  tenant: TenantContext,
  repo: TenantRepo,
  inbound: InboundWaMessage,
  getConfig: ConfigLoader,
): Promise<void> {
  const { model, sender, log = console.log } = deps;

  const conversation = await repo.getOrCreateConversation(inbound.from, inbound.profileName);

  const { message, wasDuplicate } = await repo.insertMessage({
    conversation_id: conversation.id,
    wa_message_id: inbound.waMessageId,
    direction: 'inbound',
    source: 'customer',
    type: inbound.type,
    body: inbound.body,
  });

  if (wasDuplicate) {
    // Same wa_message_id seen before. Two cases: a duplicate webhook delivery
    // (reply already exists → done) or a retry after a mid-pipeline failure
    // (no reply yet → fall through and finish the job).
    const alreadyReplied = await repo.hasOutboundReplyAfter(conversation.id, message.created_at);
    if (alreadyReplied) return;
  } else {
    await repo.updateConversationTimestamps(conversation.id, {
      lastMessageAt: message.created_at,
      lastCustomerMessageAt: message.created_at,
    });
    // Keep the in-memory row consistent for the window guard below.
    conversation.last_customer_message_at = message.created_at;
  }

  // Skip turns reference the active prompt version (NOT NULL column); load it
  // up front so every skip path below can record one.
  const promptVersion = await repo.getActivePromptVersion();

  const recordSkip = async (reason: AgentSkipReason): Promise<void> => {
    log(`[worker] skip reply (${reason}) conv=${conversation.id}`);
    if (!promptVersion) {
      log(`[worker] no active prompt_version — skip turn not recorded (${reason})`);
      return;
    }
    await repo.insertAgentTurn({
      conversation_id: conversation.id,
      message_id: message.id,
      prompt_version_id: promptVersion.id,
      model: 'none',
      latency_ms: 0,
      input_tokens: 0,
      output_tokens: 0,
      tool_calls: [],
      error: { reason },
    });
  };

  if (!tenant.agentEnabled) {
    await recordSkip('agent_disabled');
    return;
  }

  // Coexistence pause (ws-r1 §2): paused_until NULL = indefinite; an expired
  // pause is cleared lazily here — no cron.
  if (conversation.bot_paused) {
    const expired =
      conversation.paused_until !== null && Date.parse(conversation.paused_until) <= Date.now();
    if (!expired) {
      await recordSkip('bot_paused');
      return;
    }
    await repo.clearConversationPause(conversation.id);
    log(`[worker] pause expired → re-armed conv=${conversation.id}`);
  }

  if (!promptVersion) {
    log(`[worker] skip reply (no active prompt_version) tenant=${tenant.id}`);
    return;
  }

  // Missing/invalid published config skips the reply with its own reason —
  // distinct from `no_active_prompt` so tenant-health UX can tell the two
  // misconfigurations apart (ws-r1 §8.1, carried to ws-r2 §0.1).
  const config = await getConfig();
  if (!config) {
    log(`[worker] no valid published agent_config tenant=${tenant.id}`);
    await recordSkip('no_published_config');
    return;
  }

  let active: boolean;
  try {
    active = isAgentActive(config.agent, tenant.timezone);
  } catch (err) {
    // Bad tenant timezone — fail open (reply anyway) rather than poison the queue.
    log(`[worker] operating-hours evaluation failed (${String(err)}) — treating agent as active`);
    active = true;
  }
  if (!active) {
    await recordSkip('outside_operating_hours');
    return;
  }

  if (inbound.type === 'audio') {
    // Audio: persist, no reply; transcription is an R2 workstream (spec non-goals).
    await recordSkip('audio_not_supported');
    return;
  }

  // Window guard, checked BEFORE the model runs (ws-r2). R1 checked it only
  // right before the send, which was fine when a turn was pure. Now a turn can
  // create orders and write customer data, and doing that for a message we are
  // forbidden to answer would leave the customer with an order they were never
  // told about. Fail before any side effect.
  try {
    assertWithinWindow(conversation);
  } catch (err) {
    if (err instanceof OutsideWindowError) {
      log(`[worker] BLOCKED SEND — ${err.message}`);
      await recordSkip('outside_24h_window');
      return;
    }
    throw err;
  }

  const history = toModelHistory(await repo.listRecentMessages(conversation.id, HISTORY_LIMIT));
  const tools = buildToolDeclarations(config, { hasProducts: await repo.hasAnyProduct() });

  const loop = await runToolLoop({
    model,
    systemPrompt: promptVersion.compiled_prompt,
    history,
    tools,
    ctx: {
      repo,
      config,
      // Bound from the conversation we resolved, never from model arguments.
      conversationId: conversation.id,
      currency: tenant.currency,
      log,
    },
  });

  // Every model round is its own agent_turn, so token/latency accounting stays
  // cumulative and R3 can assert on the whole trace. Rounds that only called
  // tools have no outbound message to attach to — message_id is null there.
  const recordRounds = async (outboundMessageId: string | null): Promise<void> => {
    for (const [index, round] of loop.rounds.entries()) {
      const isLast = index === loop.rounds.length - 1;
      await repo.insertAgentTurn({
        conversation_id: conversation.id,
        message_id: isLast ? outboundMessageId : null,
        prompt_version_id: promptVersion.id,
        model: round.usage.model,
        latency_ms: round.usage.latencyMs,
        input_tokens: round.usage.inputTokens,
        output_tokens: round.usage.outputTokens,
        tool_calls: round.toolCalls,
        // The distinct marker for a ceiling-driven handoff (ws-r3 §0): tools ran,
        // so this is not a skip, but the trace must show why the bot stopped.
        ...(isLast && loop.hitRoundLimit ? { error: { reason: ROUND_LIMIT_HANDOFF } } : {}),
      });
    }
  };

  // ws-r3 §0 (ratified R2 Q-E): the 4-round ceiling is a REAL handoff, not just
  // a fallback message. R2 sent `escalation.handoffMessage` here but never
  // flagged the conversation or paused the bot — it promised a human and
  // summoned none. Perform the same handoff `handoff_to_human` does: flag for
  // the team and pause indefinitely, so a human owns the conversation and the
  // bot does not silently resume mid-problem. Done before the send/marker logic
  // so it happens even when no handoff message is configured to send.
  if (loop.hitRoundLimit) {
    await repo.setConversationNeedsAttention(conversation.id, true);
    await repo.setConversationPause(conversation.id, null);
    log(`[worker] round ceiling hit conv=${conversation.id} — handed off to human`);
  }

  const text = loop.text ?? (loop.hitRoundLimit ? config.escalation.handoffMessage : null);
  if (!text) {
    // No prose and no fallback worth sending (a handoff with no configured
    // message). The rounds still get recorded — the work happened, and the
    // handoff above already flagged + paused the conversation.
    await recordRounds(null);
    return;
  }

  // The invariant the runtime CLAUDE.md asks for: re-assert immediately before
  // the sender, so this send path can never drift out from under the guard.
  assertWithinWindow(conversation);

  const sent = await sender.sendText(conversation.wa_id, text);

  const { message: outbound } = await repo.insertMessage({
    conversation_id: conversation.id,
    wa_message_id: sent.waMessageId,
    direction: 'outbound',
    source: 'bot',
    type: 'text',
    body: text,
    wa_status: 'accepted',
  });

  await recordRounds(outbound.id);

  await repo.updateConversationTimestamps(conversation.id, {
    lastMessageAt: outbound.created_at,
  });
}
