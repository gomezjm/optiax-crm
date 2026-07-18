import { describe, expect, it } from 'vitest';
import { AutoReplyTriggerSchema } from '../src/schemas/auto-reply.js';

describe('AutoReplyTriggerSchema', () => {
  it('accepts keyword triggers with keywords', () => {
    const trigger = AutoReplyTriggerSchema.parse({
      kind: 'keyword',
      keywords: ['precio', 'catálogo'],
    });
    expect(trigger.keywords).toHaveLength(2);
  });

  it('accepts first_message and outside_hours without keywords', () => {
    expect(AutoReplyTriggerSchema.safeParse({ kind: 'first_message' }).success).toBe(true);
    expect(AutoReplyTriggerSchema.safeParse({ kind: 'outside_hours' }).success).toBe(true);
  });

  it('rejects keyword triggers without keywords', () => {
    expect(AutoReplyTriggerSchema.safeParse({ kind: 'keyword' }).success).toBe(false);
    expect(AutoReplyTriggerSchema.safeParse({ kind: 'keyword', keywords: [] }).success).toBe(false);
  });

  it('rejects unknown kinds and extra keys', () => {
    expect(AutoReplyTriggerSchema.safeParse({ kind: 'regex' }).success).toBe(false);
    expect(
      AutoReplyTriggerSchema.safeParse({ kind: 'first_message', delay: 5 }).success,
    ).toBe(false);
  });
});
