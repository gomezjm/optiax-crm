/**
 * Meta's 24-hour customer-service window (ws-r1 spec §3): free-form messages
 * may only be sent within 24h of the customer's last message. One central
 * guard in the send path — future callers (campaigns, dashboard composer, R2
 * tools) inherit enforcement for free.
 *
 * Ratified (fixture-session Q2): the window derives from our own
 * `last_customer_message_at` + clock, never from the webhook
 * `conversation.expiration_timestamp` field.
 */

export const WINDOW_HOURS = 24;
const WINDOW_MS = WINDOW_HOURS * 60 * 60 * 1000;

export interface WindowConversation {
  id: string;
  /** ISO timestamp of the customer's last message; null = never messaged. */
  last_customer_message_at: string | null;
}

export class OutsideWindowError extends Error {
  constructor(readonly conversationId: string, lastCustomerMessageAt: string | null) {
    super(
      `conversation ${conversationId} is outside the 24h window ` +
        `(last_customer_message_at=${lastCustomerMessageAt ?? 'never'})`,
    );
    this.name = 'OutsideWindowError';
  }
}

export function isWithinWindow(
  lastCustomerMessageAt: string | null,
  now: Date = new Date(),
): boolean {
  if (lastCustomerMessageAt === null) return false; // never messaged → outside
  const last = Date.parse(lastCustomerMessageAt);
  if (Number.isNaN(last)) return false;
  return now.getTime() - last < WINDOW_MS;
}

/** Throws OutsideWindowError when a free-form send would violate the window. */
export function assertWithinWindow(conversation: WindowConversation, now: Date = new Date()): void {
  if (!isWithinWindow(conversation.last_customer_message_at, now)) {
    throw new OutsideWindowError(conversation.id, conversation.last_customer_message_at);
  }
}
