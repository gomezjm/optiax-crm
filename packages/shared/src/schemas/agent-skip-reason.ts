import { z } from 'zod';

/**
 * Canonical reasons the runtime records when it persists an inbound message
 * but deliberately skips the agent reply (ws-r1 spec §4). Stored in
 * `agent_turns.error` as `{ reason: AgentSkipReason }` — the column stays
 * jsonb, this enum is the TS/Zod contract over it.
 *
 * `no_active_prompt` (no active prompt_versions row) and `no_published_config`
 * (no valid published agent_config) are deliberately distinct: the D-phase
 * tenant-health UX has to tell the two misconfigurations apart (ws-r1 §8.1).
 */
export const AGENT_SKIP_REASONS = [
  'bot_paused',
  'outside_operating_hours',
  'outside_24h_window',
  'agent_disabled',
  'audio_not_supported',
  'no_active_prompt',
  'no_published_config',
] as const;

export const AgentSkipReasonSchema = z.enum(AGENT_SKIP_REASONS);

export type AgentSkipReason = z.infer<typeof AgentSkipReasonSchema>;
