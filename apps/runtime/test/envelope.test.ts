import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseEnvelope } from '../src/wa/envelope.js';

const FIXTURES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../packages/shared/fixtures/360dialog',
);

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(FIXTURES, `${name}.json`), 'utf8'));
}

describe('parseEnvelope', () => {
  it('parses inbound-text: phone_number_id, message, profile name', () => {
    const parsed = parseEnvelope(fixture('inbound-text'));
    expect(parsed.phoneNumberId).toBe('111000111000111');
    expect(parsed.field).toBe('messages');
    expect(parsed.statuses).toEqual([]);
    expect(parsed.messages).toHaveLength(1);
    const message = parsed.messages[0];
    expect(message?.from).toBe('573015550101');
    expect(message?.type).toBe('text');
    expect(message?.body).toContain('blusa de lino');
    expect(message?.profileName).toBe('Camila Rojas');
  });

  it('parses inbound-audio as audio with null body', () => {
    const parsed = parseEnvelope(fixture('inbound-audio'));
    expect(parsed.phoneNumberId).toBe('222000222000222');
    expect(parsed.messages[0]?.type).toBe('audio');
    expect(parsed.messages[0]?.body).toBeNull();
  });

  it('parses inbound-image caption as body', () => {
    const parsed = parseEnvelope(fixture('inbound-image'));
    expect(parsed.messages[0]?.type).toBe('image');
    expect(typeof parsed.messages[0]?.body).toBe('string');
  });

  it('parses echo-owner-reply: owner message under echoes, not messages', () => {
    const parsed = parseEnvelope(fixture('echo-owner-reply'));
    expect(parsed.phoneNumberId).toBe('111000111000111');
    expect(parsed.field).toBe('smb_message_echoes');
    expect(parsed.messages).toEqual([]);
    expect(parsed.statuses).toEqual([]);
    expect(parsed.echoes).toHaveLength(1);
    const echo = parsed.echoes[0];
    expect(echo?.to).toBe('573015550101');
    expect(echo?.type).toBe('text');
    expect(echo?.body).toContain('Valentina');
    expect(echo?.waMessageId).toMatch(/^wamid\./);
  });

  it('history-sync: nothing extracted (threads nest under value.history, not value.messages)', () => {
    const parsed = parseEnvelope(fixture('history-sync'));
    expect(parsed.phoneNumberId).toBe('222000222000222');
    expect(parsed.messages).toEqual([]);
    expect(parsed.statuses).toEqual([]);
    expect(parsed.echoes).toEqual([]);
  });

  it('parses status updates', () => {
    for (const [name, status] of [
      ['status-sent', 'sent'],
      ['status-delivered', 'delivered'],
      ['status-read', 'read'],
      ['status-failed', 'failed'],
    ] as const) {
      const parsed = parseEnvelope(fixture(name));
      expect(parsed.messages).toEqual([]);
      expect(parsed.statuses).toHaveLength(1);
      expect(parsed.statuses[0]?.status).toBe(status);
    }
  });

  it('tolerates garbage input', () => {
    for (const garbage of [null, 42, 'x', [], {}, { entry: [{}] }]) {
      const parsed = parseEnvelope(garbage);
      expect(parsed.phoneNumberId).toBeNull();
      expect(parsed.messages).toEqual([]);
      expect(parsed.statuses).toEqual([]);
      expect(parsed.echoes).toEqual([]);
    }
  });
});
