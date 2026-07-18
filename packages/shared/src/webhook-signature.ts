import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * STUB signing scheme (spec §7): HMAC-SHA256 over the raw body, hex-encoded,
 * sent as `x-webhook-signature`. The real 360dialog scheme is unconfirmed —
 * when it is, swap the internals of these two functions and nothing else.
 */

const DEFAULT_DEV_SECRET = 'optiax-dev-webhook-secret';

export const WEBHOOK_SIGNATURE_HEADER = 'x-webhook-signature';

function secretOrDefault(secret?: string): string {
  return secret ?? process.env.WEBHOOK_SECRET ?? DEFAULT_DEV_SECRET;
}

export function signWebhookPayload(rawBody: string, secret?: string): string {
  return createHmac('sha256', secretOrDefault(secret)).update(rawBody, 'utf8').digest('hex');
}

export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret?: string,
): boolean {
  const expected = signWebhookPayload(rawBody, secret);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
