/**
 * Map `messages` rows to model history (spec §2).
 *
 * Roles: customer → user; bot/owner_app/dashboard/campaign → assistant.
 * `system` rows (e.g. "order created" notices) are internal — skipped.
 * Non-text messages become placeholder lines so the model keeps continuity.
 */
import type { MessageRow } from '../db/index.js';
import type { ModelHistoryEntry } from './types.js';

const PLACEHOLDERS: Partial<Record<MessageRow['type'], string>> = {
  image: '[imagen]',
  audio: '[audio]',
  video: '[video]',
  document: '[documento]',
  other: '[mensaje]',
};

export function toModelHistory(messages: MessageRow[]): ModelHistoryEntry[] {
  const history: ModelHistoryEntry[] = [];
  for (const message of messages) {
    if (message.source === 'system') continue;
    const role = message.source === 'customer' ? 'user' : 'assistant';

    let text: string | null;
    if (message.type === 'text' || message.type === 'template') {
      text = message.body;
    } else {
      const placeholder = PLACEHOLDERS[message.type] ?? '[mensaje]';
      text = message.body ? `${placeholder} ${message.body}` : placeholder;
    }
    if (!text) continue;

    history.push({ role, text });
  }
  return history;
}
