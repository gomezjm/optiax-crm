import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Json } from '@optiax/shared';
import { processWebhookEvent, DEFAULT_PAUSE_HOURS } from '../src/worker/pipeline.js';
import { FakeModel } from '../src/model/fake.js';
import { MockWaSender } from '../src/wa/sender.js';
import { FakeDb, makeAgentConfig } from './fakes.js';

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
  timezone: 'America/Bogota',
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

  it('bot_paused (paused_until in the future): persisted, no reply, skip turn recorded', async () => {
    const { db, model, deps } = setup();
    db.addConversation({
      tenant_id: TENANT.id,
      wa_id: '573015550101',
      bot_paused: true,
      paused_until: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const eventId = db.addEvent(fixture('inbound-text'));

    await processWebhookEvent(deps, eventId);

    expect(db.messages).toHaveLength(1);
    expect(db.messages[0]?.direction).toBe('inbound');
    expect(model.calls).toHaveLength(0);
    expect(db.agentTurns).toHaveLength(1);
    expect(db.agentTurns[0]?.error).toMatchObject({ reason: 'bot_paused' });
    expect(db.agentTurns[0]?.model).toBe('none');
    expect(db.events.get(eventId)?.processed_at).not.toBeNull();
  });

  it('bot_paused with paused_until NULL: indefinite pause, never re-arms', async () => {
    const { db, model, deps } = setup();
    const conversation = db.addConversation({
      tenant_id: TENANT.id,
      wa_id: '573015550101',
      bot_paused: true,
      paused_until: null,
    });
    const eventId = db.addEvent(fixture('inbound-text'));

    await processWebhookEvent(deps, eventId);

    expect(model.calls).toHaveLength(0);
    expect(conversation.bot_paused).toBe(true);
    expect(db.agentTurns[0]?.error).toMatchObject({ reason: 'bot_paused' });
  });

  it('expired pause: lazy re-arm clears the flag and replies normally', async () => {
    const { db, model, deps } = setup();
    const conversation = db.addConversation({
      tenant_id: TENANT.id,
      wa_id: '573015550101',
      bot_paused: true,
      paused_until: new Date(Date.now() - 60_000).toISOString(),
    });
    const eventId = db.addEvent(fixture('inbound-text'));

    await processWebhookEvent(deps, eventId);

    expect(conversation.bot_paused).toBe(false);
    expect(conversation.paused_until).toBeNull();
    expect(model.calls).toHaveLength(1);
    expect(db.messages.filter((m) => m.direction === 'outbound')).toHaveLength(1);
    expect(db.agentTurns).toHaveLength(1);
    expect(db.agentTurns[0]?.error).toBeUndefined();
  });

  it('agent_enabled=false: inbound persisted, no reply, skip turn recorded', async () => {
    const { db, model, deps } = setup({ agentEnabled: false });
    const eventId = db.addEvent(fixture('inbound-text'));

    await processWebhookEvent(deps, eventId);

    expect(db.messages).toHaveLength(1);
    expect(model.calls).toHaveLength(0);
    expect(db.agentTurns).toHaveLength(1);
    expect(db.agentTurns[0]?.error).toMatchObject({ reason: 'agent_disabled' });
  });

  it('missing published config: treated like no active prompt, skip turn recorded', async () => {
    const db = new FakeDb();
    db.addTenant({ tenant: TENANT, phoneNumberId: PHONE_NUMBER_ID, config: null });
    const model = new FakeModel();
    const deps = { db, model, sender: new MockWaSender(), log: () => {} };
    const eventId = db.addEvent(fixture('inbound-text'));

    await processWebhookEvent(deps, eventId);

    expect(db.messages).toHaveLength(1);
    expect(model.calls).toHaveLength(0);
    expect(db.agentTurns).toHaveLength(1);
    expect(db.agentTurns[0]?.error).toMatchObject({ reason: 'no_active_prompt' });
  });

  it('operating hours: inactive schedule → persisted, no reply, skip turn recorded', async () => {
    const db = new FakeDb();
    db.addTenant({
      tenant: TENANT,
      phoneNumberId: PHONE_NUMBER_ID,
      // Zero-width range: never in schedule, so 'schedule' mode is always
      // inactive — deterministic regardless of when the test runs.
      config: makeAgentConfig({
        operatingMode: 'schedule',
        schedule: { days: [0, 1, 2, 3, 4, 5, 6], start: '09:00', end: '09:00' },
      }),
    });
    const model = new FakeModel();
    const deps = { db, model, sender: new MockWaSender(), log: () => {} };
    const eventId = db.addEvent(fixture('inbound-text'));

    await processWebhookEvent(deps, eventId);

    expect(db.messages).toHaveLength(1);
    expect(model.calls).toHaveLength(0);
    expect(db.agentTurns[0]?.error).toMatchObject({ reason: 'outside_operating_hours' });
  });

  it('outside 24h window: send blocked, skip turn recorded (retry of a stale inbound)', async () => {
    const { db, model, sender, deps } = setup();
    const conversation = db.addConversation({
      tenant_id: TENANT.id,
      wa_id: '573015550101',
      last_customer_message_at: new Date(Date.now() - 48 * 3_600_000).toISOString(),
    });
    // Pre-existing inbound row with the fixture's wa_message_id and no reply
    // after it — the retry path re-enters the reply flow with a stale window.
    const raw = JSON.parse(JSON.stringify(fixture('inbound-text'))) as {
      entry: Array<{ changes: Array<{ value: { messages: Array<{ id: string }> } }> }>;
    };
    const wamid = raw.entry[0]!.changes[0]!.value.messages[0]!.id;
    await db.createTenantRepo(TENANT.id).insertMessage({
      conversation_id: conversation.id,
      wa_message_id: wamid,
      direction: 'inbound',
      source: 'customer',
      type: 'text',
      body: 'hola',
    });
    const eventId = db.addEvent(fixture('inbound-text'));

    await processWebhookEvent(deps, eventId);

    expect(model.calls).toHaveLength(1); // reply was generated…
    expect(sender.sent).toHaveLength(0); // …but the send was blocked
    expect(db.messages.filter((m) => m.direction === 'outbound')).toHaveLength(0);
    expect(db.agentTurns).toHaveLength(1);
    expect(db.agentTurns[0]?.error).toMatchObject({ reason: 'outside_24h_window' });
    expect(db.events.get(eventId)?.processed_at).not.toBeNull();
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

  it('status rank guard: a late delivered never overwrites read', async () => {
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

    await processWebhookEvent(deps, db.addEvent(fixture('status-read')));
    expect(db.messages.find((m) => m.id === message.id)?.wa_status).toBe('read');

    await processWebhookEvent(deps, db.addEvent(fixture('status-delivered')));
    expect(db.messages.find((m) => m.id === message.id)?.wa_status).toBe('read');
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

describe('owner echo handling (coexistence pause)', () => {
  const HOUR_MS = 3_600_000;
  // The seeded config uses the schema default pauseHoursOnOwnerReply = 24.
  const expectPausedForDefaultHours = (pausedUntil: string | null, from: number) => {
    expect(pausedUntil).not.toBeNull();
    const delta = Date.parse(pausedUntil!) - from;
    expect(delta).toBeGreaterThan((DEFAULT_PAUSE_HOURS - 1) * HOUR_MS);
    expect(delta).toBeLessThanOrEqual(DEFAULT_PAUSE_HOURS * HOUR_MS + 60_000);
  };

  it('echo → owner message persisted + pause set; 24h window untouched', async () => {
    const { db, model, deps } = setup();
    const before = Date.now();
    const eventId = db.addEvent(fixture('echo-owner-reply'));

    await processWebhookEvent(deps, eventId);

    expect(db.messages).toHaveLength(1);
    const owner = db.messages[0];
    expect(owner?.direction).toBe('outbound');
    expect(owner?.source).toBe('owner_app');
    expect(owner?.type).toBe('text');
    expect(owner?.body).toContain('Valentina');
    expect(model.calls).toHaveLength(0); // echoes never trigger a reply

    const conversation = db.conversations[0];
    expect(conversation?.wa_id).toBe('573015550101');
    expect(conversation?.bot_paused).toBe(true);
    expectPausedForDefaultHours(conversation?.paused_until ?? null, before);
    expect(conversation?.last_message_at).toBe(owner?.created_at);
    expect(conversation?.last_customer_message_at).toBeNull(); // echoes don't open the window
    expect(db.events.get(eventId)?.processed_at).not.toBeNull();
  });

  it('second echo extends paused_until (owner still active)', async () => {
    const { db, deps } = setup();
    const conversation = db.addConversation({
      tenant_id: TENANT.id,
      wa_id: '573015550101',
      bot_paused: true,
      paused_until: new Date(Date.now() + 2 * HOUR_MS).toISOString(),
    });
    const firstPausedUntil = conversation.paused_until;

    await processWebhookEvent(deps, db.addEvent(fixture('echo-owner-reply')));

    expect(conversation.bot_paused).toBe(true);
    expect(Date.parse(conversation.paused_until!)).toBeGreaterThan(
      Date.parse(firstPausedUntil!),
    );
  });

  it('echo idempotency: same echo processed twice → one row, pause not re-extended', async () => {
    const { db, deps } = setup();

    await processWebhookEvent(deps, db.addEvent(fixture('echo-owner-reply')));
    const pausedUntilAfterFirst = db.conversations[0]?.paused_until;

    await processWebhookEvent(deps, db.addEvent(fixture('echo-owner-reply')));

    expect(db.messages).toHaveLength(1);
    expect(db.conversations[0]?.paused_until).toBe(pausedUntilAfterFirst);
  });

  it('retry after mid-echo failure still sets the pause (duplicate row, no pause yet)', async () => {
    const { db, deps } = setup();
    const eventId = db.addEvent(fixture('echo-owner-reply'));

    const brokenRepo = db.createTenantRepo(TENANT.id);
    const failingDb = Object.create(db) as FakeDb;
    failingDb.createTenantRepo = () => ({
      ...brokenRepo,
      setConversationPause: () => Promise.reject(new Error('db hiccup')),
    });
    await expect(processWebhookEvent({ ...deps, db: failingDb }, eventId)).rejects.toThrow(
      'db hiccup',
    );
    expect(db.messages).toHaveLength(1);
    expect(db.conversations[0]?.bot_paused).toBe(false);

    await processWebhookEvent(deps, eventId);

    expect(db.messages).toHaveLength(1);
    expect(db.conversations[0]?.bot_paused).toBe(true);
    expect(db.conversations[0]?.paused_until).not.toBeNull();
  });

  it('echo on an indefinitely-paused conversation leaves paused_until NULL', async () => {
    const { db, deps } = setup();
    const conversation = db.addConversation({
      tenant_id: TENANT.id,
      wa_id: '573015550101',
      bot_paused: true,
      paused_until: null, // manual dashboard pause = indefinite
    });

    await processWebhookEvent(deps, db.addEvent(fixture('echo-owner-reply')));

    expect(db.messages).toHaveLength(1); // owner message still persisted
    expect(conversation.bot_paused).toBe(true);
    expect(conversation.paused_until).toBeNull();
  });

  it('missing published config: pause still set with the default hours', async () => {
    const db = new FakeDb();
    db.addTenant({ tenant: TENANT, phoneNumberId: PHONE_NUMBER_ID, config: null });
    const deps = { db, model: new FakeModel(), sender: new MockWaSender(), log: () => {} };
    const before = Date.now();

    await processWebhookEvent(deps, db.addEvent(fixture('echo-owner-reply')));

    const conversation = db.conversations[0];
    expect(conversation?.bot_paused).toBe(true);
    expectPausedForDefaultHours(conversation?.paused_until ?? null, before);
  });

  it('echo then inbound in one flow: customer message gets no reply, skip turn recorded', async () => {
    const { db, model, deps } = setup();

    await processWebhookEvent(deps, db.addEvent(fixture('echo-owner-reply')));
    await processWebhookEvent(deps, db.addEvent(fixture('inbound-text')));

    expect(db.messages.map((m) => m.source)).toEqual(['owner_app', 'customer']);
    expect(model.calls).toHaveLength(0);
    expect(db.agentTurns).toHaveLength(1);
    expect(db.agentTurns[0]?.error).toMatchObject({ reason: 'bot_paused' });
  });
});
