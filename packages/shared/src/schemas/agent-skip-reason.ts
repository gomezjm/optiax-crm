import { z } from 'zod';

/**
 * Canonical reasons the runtime records when it persists an inbound message
 * but deliberately skips the agent reply (ws-r1 spec §4). Stored in
 * `agent_turns.error` as `{ reason: AgentSkipReason }` — the column stays
 * jsonb, this enum is the TS/Zod contract over it.
 */
export const AGENT_SKIP_REASONS = [
  'bot_paused',
  'outside_operating_hours',
  'outside_24h_window',
  'agent_disabled',
  'audio_not_supported',
  'no_active_prompt',
] as const;

export const AgentSkipReasonSchema = z.enum(AGENT_SKIP_REASONS);

export type AgentSkipReason = z.infer<typeof AgentSkipReasonSchema>;
