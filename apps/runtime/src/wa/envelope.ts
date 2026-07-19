/**
 * Defensive parsing of the 360dialog-forwarded Meta Cloud API webhook envelope.
 *
 * Shape provenance — captured sandbox deliveries, 2026-07-19 (fixtures/README.md):
 * inbound `messages` and `statuses` (sent/delivered/read) are captured-verified.
 * Every path this parser extracts exists in the captures. Real payloads also
 * carry fields we deliberately ignore: `contacts[].user_id` /
 * `messages[].from_user_id` / `statuses[].recipient_user_id`, plus
 * `conversation` and `pricing` on statuses; status deliveries include a
 * `contacts` array without `profile`, so `profile.name` must stay optional.
 * Echo (`smb_message_echoes`) and history shapes remain reconstructions —
 * coexistence-only, the sandbox cannot emit them.
 *
 * Runtime-local on purpose (ratified P1-Q2). Graduation to `packages/shared`
 * stays deferred until the echo shape is also captured-verified. No zod here —
 * plain narrowing over `unknown`.
 */
import type { Database } from '@optiax/shared';

type MsgType = Database['public']['Enums']['e_msg_type'];
type WaStatus = Database['public']['Enums']['e_wa_status'];

export interface InboundWaMessage {
  waMessageId: string;
  from: string;
  type: MsgType;
  /** text body or media caption; null for e.g. voice notes */
  body: string | null;
  profileName: string | null;
}

export interface WaStatusUpdate {
  waMessageId: string;
  status: WaStatus;
}

export interface ParsedEnvelope {
  phoneNumberId: string | null;
  field: string | null;
  messages: InboundWaMessage[];
  statuses: WaStatusUpdate[];
}

const INBOUND_TYPES: readonly MsgType[] = ['text', 'image', 'audio', 'video', 'document'];
const STATUS_VALUES: readonly WaStatus[] = ['accepted', 'sent', 'delivered', 'read', 'failed'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function toMsgType(raw: unknown): MsgType {
  return INBOUND_TYPES.includes(raw as MsgType) ? (raw as MsgType) : 'other';
}

function extractBody(message: Record<string, unknown>, type: MsgType): string | null {
  if (type === 'text') {
    const text = message['text'];
    return isRecord(text) ? asString(text['body']) : null;
  }
  // Media messages may carry a caption.
  const media = message[type];
  return isRecord(media) ? asString(media['caption']) : null;
}

export function parseEnvelope(payload: unknown): ParsedEnvelope {
  const parsed: ParsedEnvelope = { phoneNumberId: null, field: null, messages: [], statuses: [] };
  if (!isRecord(payload) || !Array.isArray(payload['entry'])) return parsed;

  for (const entry of payload['entry']) {
    if (!isRecord(entry) || !Array.isArray(entry['changes'])) continue;
    for (const change of entry['changes']) {
      if (!isRecord(change)) continue;
      parsed.field ??= asString(change['field']);
      const value = change['value'];
      if (!isRecord(value)) continue;

      const metadata = value['metadata'];
      if (isRecord(metadata)) parsed.phoneNumberId ??= asString(metadata['phone_number_id']);

      const profileByWaId = new Map<string, string>();
      if (Array.isArray(value['contacts'])) {
        for (const contact of value['contacts']) {
          if (!isRecord(contact)) continue;
          const waId = asString(contact['wa_id']);
          const profile = contact['profile'];
          const name = isRecord(profile) ? asString(profile['name']) : null;
          if (waId && name) profileByWaId.set(waId, name);
        }
      }

      if (Array.isArray(value['messages'])) {
        for (const message of value['messages']) {
          if (!isRecord(message)) continue;
          const waMessageId = asString(message['id']);
          const from = asString(message['from']);
          if (!waMessageId || !from) continue;
          const type = toMsgType(message['type']);
          parsed.messages.push({
            waMessageId,
            from,
            type,
            body: extractBody(message, type),
            profileName: profileByWaId.get(from) ?? null,
          });
        }
      }

      if (Array.isArray(value['statuses'])) {
        for (const status of value['statuses']) {
          if (!isRecord(status)) continue;
          const waMessageId = asString(status['id']);
          const statusValue = asString(status['status']);
          if (!waMessageId || !STATUS_VALUES.includes(statusValue as WaStatus)) continue;
          parsed.statuses.push({ waMessageId, status: statusValue as WaStatus });
        }
      }
    }
  }
  return parsed;
}
