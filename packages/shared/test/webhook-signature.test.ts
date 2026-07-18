import { describe, expect, it } from 'vitest';
import { signWebhookPayload, verifyWebhookSignature } from '../src/webhook-signature.js';

describe('webhook signature stub', () => {
  const body = JSON.stringify({ entry: [] });

  it('round-trips sign → verify', () => {
    const sig = signWebhookPayload(body, 'test-secret');
    expect(verifyWebhookSignature(body, sig, 'test-secret')).toBe(true);
  });

  it('rejects a tampered body', () => {
    const sig = signWebhookPayload(body, 'test-secret');
    expect(verifyWebhookSignature(body + ' ', sig, 'test-secret')).toBe(false);
  });

  it('rejects a wrong secret and malformed signatures', () => {
    const sig = signWebhookPayload(body, 'test-secret');
    expect(verifyWebhookSignature(body, sig, 'other-secret')).toBe(false);
    expect(verifyWebhookSignature(body, 'nonsense', 'test-secret')).toBe(false);
    expect(verifyWebhookSignature(body, '', 'test-secret')).toBe(false);
  });
});
