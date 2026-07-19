import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Json } from '@optiax/shared';
import { processWebhookEvent } from '../src/worker/pipeline.js';
import { FakeModel } from '../src/model/fake.js';
import { MockWaSender } from '../src/wa/sender.js';
import { FakeDb } from './fakes.js';

const FIXTURES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../packages/shared/fixtures/360dialog',
);

function fixture(name: string): Json {
  return JSON.parse(readFileSync(resolve(FIXTURES, `${name}.json`), 'utf8')) as Json;
}

const TENANT = {
  id: 'aa000000-0001-4000-8000-000000000001',
  name: 'Moda Valentina',
  agentEnabled: true,
  activePromptVersionId: 'pv-1',
};
const PHONE_NUMBER_ID = '111000111000111';

function setup(overrides: Partial<typeof TENANT> = {}) {
  const db = new FakeDb();
  db.addTenant({ tenant: { ...TENANT, ...overrides }, phoneNumberId: PHONE_NUMBER_ID });
  const model = new FakeModel('¡Claro! Sí tenemos la blusa en talla M.');
  const sender = new MockWaSender();
  const deps = { db, model, sender, log: () => {} };
  return { db, model, sender, deps };
}

describe('processWebhookEvent', () => {
  it('known tenant: persists inbound, replies, records agent_turn + timestamps', async () => {
    const { db, model, sender, deps } = setup();
    const eventId = db.addEvent(fixture('inbound-text'));

    await processWebhookEvent(deps, eventId);

    expect(db.messages).toHaveLength(2);
    const [inbound, outbound] = db.messages;
    expect(inbound?.direction).toBe('inbound');
    expect(inbound?.source).toBe('customer');
    expect(outbound?.direction).toBe('outbound');
    expect(outbound?.source).toBe('bot');
    expect(outbound?.wa_status).toBe('accepted');
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0]?.systemPrompt).toBe('SYSTEM PROMPT');
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.to).toBe('573015550101');
    expect(db.agentTurns).toHaveLength(1);
    expect(db.agentTurns[0]?.error).toBeUndefined();

    const conversation = db.conversations[0];
    expect(conversation?.last_customer_message_at).toBe(inbound?.created_at);
    expect(conversation?.last_message_at).toBe(outbound?.created_at);
    expect(db.events.get(eventId)?.processed_at).not.toBeNull();
  });

  it('unknown phone_number_id: event marked with error, no crash', async () => {
    const { db, model, deps } = setup();
    db.tenants.clear();
    const eventId = db.addEvent(fixture('inbound-text'));

    await processWebhookEvent(deps, eventId);

    expect(db.events.get(eventId)?.error).toMatchObject({ reason: 'unknown_phone_number_id' });
    expect(db.messages).toHaveLength(0);
    expect(model.calls).toHaveLength(0);
  });

  it('dedupe: same event processed twice → one inbound row, one reply', async () => {
    const { db, model, deps } = setup();
    const first = db.addEvent(fixture('inbound-text'));
    const second = db.addEvent(fixture('inbound-text'));

    await processWebhookEvent(deps, first);
    await processWebhookEvent(deps, second);

    expect(db.messages.filter((m) => m.direction === 'inbound')).toHaveLength(1);
    expect(db.messages.filter((m) => m.direction === 'outbound')).toHaveLength(1);
    expect(model.calls).toHaveLength(1);
  });

  it('retry after mid-pipeline failure still replies (duplicate insert but no reply yet)', async () => {
    const { db, deps, model, sender } = setup();
    const eventId = db.addEvent(fixture('inbound-text'));

    const failingDeps = {
      ...deps,
      model: {
        generateReply: () => Promise.reject(new Error('gemini 500')),
      },
    };
    await expect(processWebhookEvent(failingDeps, eventId)).rejects.toThrow('gemini 500');
    expect(db.messages).toHaveLength(1); // inbound persisted, no reply

    await processWebhookEvent({ ...deps, model, sender }, eventId);
    expect(db.messages.filter((m) => m.direction === 'outbound')).toHaveLength(1);
    expect(model.calls).toHaveLength(1);
  });

  it('bot_paused: inbound persisted, no reply', async () => {
    const { db, model, deps } = setup();
    db.addConversation({
      tenant_id: TENANT.id,
      wa_id: '573015550101',
      bot_paused: true,
    });
    const eventId = db.addEvent(fixture('inbound-text'));

    await processWebhookEvent(deps, eventId);

    expect(db.messages).toHaveLength(1);
    expect(db.messages[0]?.direction).toBe('inbound');
    expect(model.calls).toHaveLength(0);
    expect(db.events.get(eventId)?.processed_at).not.toBeNull();
  });

  it('agent_enabled=false: inbound persisted, no reply', async () => {
    const { db, model, deps } = setup({ agentEnabled: false });
    const eventId = db.addEvent(fixture('inbound-text'));

    await processWebhookEvent(deps, eventId);

    expect(db.messages).toHaveLength(1);
    expect(model.calls).toHaveLength(0);
  });

  it('audio: persisted, no reply, skip reason logged in agent_turns.error', async () => {
    const db = new FakeDb();
    db.addTenant({
      tenant: { ...TENANT, id: 'bb000000-0001-4000-8000-000000000001', name: 'Sabor Casero' },
      phoneNumberId: '222000222000222',
    });
    const model = new FakeModel();
    const deps = { db, model, sender: new MockWaSender(), log: () => {} };
    const eventId = db.addEvent(fixture('inbound-audio'));

    await processWebhookEvent(deps, eventId);

    expect(db.messages).toHaveLength(1);
    expect(db.messages[0]?.type).toBe('audio');
    expect(model.calls).toHaveLength(0);
    expect(db.agentTurns).toHaveLength(1);
    expect(db.agentTurns[0]?.error).toMatchObject({ reason: 'audio_not_supported' });
  });

  it('statuses: updates wa_status of an existing message, ignores unknown ids', async () => {
    const { db, deps } = setup();
    const conversation = db.addConversation({ tenant_id: TENANT.id, wa_id: '573015550101' });
    const repo = db.createTenantRepo(TENANT.id);
    const { message } = await repo.insertMessage({
      conversation_id: conversation.id,
      wa_message_id:
        'wamid.HBgMNTczMDE1NTUwMTAxFQIAEhggQTMwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAA',
      direction: 'outbound',
      source: 'bot',
      type: 'text',
      body: 'hola',
    });

    const eventId = db.addEvent(fixture('status-delivered'));
    await processWebhookEvent(deps, eventId);

    expect(db.messages.find((m) => m.id === message.id)?.wa_status).toBe('delivered');
    expect(db.events.get(eventId)?.processed_at).not.toBeNull();
  });
});
