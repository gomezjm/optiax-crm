/**
 * Per-webhook-event processing (spec §1): resolve tenant → dedupe → load
 * context → model reply → persist + send. Throwing here means "retry me" —
 * the worker's visibility-timeout/poison logic decides what happens next.
 * Terminal, non-retryable outcomes (unknown tenant, malformed payload) mark
 * the webhook_events row with an error and return normally so the queue drains.
 */
import type { RuntimeDb, TenantContext, TenantRepo } from '../db/index.js';
import type { AgentModel } from '../model/types.js';
import { toModelHistory } from '../model/history.js';
import type { WaSender } from '../wa/sender.js';
import { parseEnvelope, type InboundWaMessage } from '../wa/envelope.js';

export const HISTORY_LIMIT = 20;

export interface PipelineDeps {
  db: RuntimeDb;
  model: AgentModel;
  sender: WaSender;
  log?: (message: string) => void;
}

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

  for (const status of envelope.statuses) {
    await repo.updateMessageWaStatus(status.waMessageId, status.status);
  }

  for (const message of envelope.messages) {
    await handleInboundMessage(deps, tenant, repo, message);
  }

  await db.webhookEvents.markProcessed(webhookEventId);
}

async function handleInboundMessage(
  deps: PipelineDeps,
  tenant: TenantContext,
  repo: TenantRepo,
  inbound: InboundWaMessage,
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
  }

  // Flag checks only — R1 owns *setting* these flags (spec non-goals).
  if (!tenant.agentEnabled || conversation.bot_paused) {
    log(
      `[worker] skip reply (${!tenant.agentEnabled ? 'agent_disabled' : 'bot_paused'}) conv=${conversation.id}`,
    );
    return;
  }

  const promptVersion = await repo.getActivePromptVersion();
  if (!promptVersion) {
    log(`[worker] skip reply (no active prompt_version) tenant=${tenant.id}`);
    return;
  }

  if (inbound.type === 'audio') {
    // Audio: persist, no reply; transcription is an R2 workstream (spec non-goals).
    await repo.insertAgentTurn({
      conversation_id: conversation.id,
      message_id: message.id,
      prompt_version_id: promptVersion.id,
      model: 'none',
      latency_ms: 0,
      input_tokens: 0,
      output_tokens: 0,
      tool_calls: [],
      error: { reason: 'audio_not_supported' },
    });
    return;
  }

  const history = toModelHistory(await repo.listRecentMessages(conversation.id, HISTORY_LIMIT));
  const reply = await model.generateReply({
    systemPrompt: promptVersion.compiled_prompt,
    history,
  });

  const sent = await sender.sendText(conversation.wa_id, reply.text);

  const { message: outbound } = await repo.insertMessage({
    conversation_id: conversation.id,
    wa_message_id: sent.waMessageId,
    direction: 'outbound',
    source: 'bot',
    type: 'text',
    body: reply.text,
    wa_status: 'accepted',
  });

  await repo.insertAgentTurn({
    conversation_id: conversation.id,
    message_id: outbound.id,
    prompt_version_id: promptVersion.id,
    model: reply.model,
    latency_ms: reply.latencyMs,
    input_tokens: reply.inputTokens,
    output_tokens: reply.outputTokens,
    tool_calls: [],
  });

  await repo.updateConversationTimestamps(conversation.id, {
    lastMessageAt: outbound.created_at,
  });
}
