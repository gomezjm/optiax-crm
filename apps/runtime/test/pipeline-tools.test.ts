/**
 * The tool loop as the worker actually runs it (ws-r2 §2, §5, §6): agent_turns
 * accounting across rounds, the round-limit fallback, media handling, and the
 * R1 guards still holding in front of tools that can now write.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Json } from '@optiax/shared';
import { processWebhookEvent } from '../src/worker/pipeline.js';
import { FakeModel, textTurn, toolCallTurn, type ScriptedTurn } from '../src/model/fake.js';
import { MockWaSender } from '../src/wa/sender.js';
import { MAX_MODEL_ROUNDS } from '../src/tools/index.js';
import { FakeDb, makeAgentConfig, type AgentConfigOverrides } from './fakes.js';

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
  currency: 'COP',
};
const PHONE_NUMBER_ID = '111000111000111';
const WA_ID = '573015550101';

function setup(script: ScriptedTurn[] = [], overrides: AgentConfigOverrides = {}) {
  const db = new FakeDb();
  db.addTenant({
    tenant: TENANT,
    phoneNumberId: PHONE_NUMBER_ID,
    config: makeAgentConfig({}, overrides),
  });
  const customer = db.addCustomer({ tenant_id: TENANT.id, wa_id: WA_ID });
  const conversation = db.addConversation({
    tenant_id: TENANT.id,
    wa_id: WA_ID,
    customer_id: customer.id,
  });
  db.addOrderStatus(TENANT.id, 'Nuevo', 'new');
  const product = db.addProduct({ tenant_id: TENANT.id, name: 'Blusa blanca', price: 55000 });

  const model = new FakeModel('Respuesta genérica.', script);
  const sender = new MockWaSender();
  return { db, model, sender, deps: { db, model, sender, log: () => {} }, customer, conversation, product };
}

describe('pipeline with tools', () => {
  it('capture then order: one agent_turn per round, tool_calls populated', async () => {
    const s = setup([], { orders: { enabled: true, confirmBeforeCreate: false } });
    const script = [
      toolCallTurn({ name: 'capture_customer', args: { name: 'Ana Pérez', city: 'Bogotá' } }),
      toolCallTurn({
        name: 'create_order',
        args: { items: [{ product_id: s.product.id, qty: 2 }] },
      }),
      textTurn('¡Listo Ana! Tu pedido de 2 blusas quedó registrado.'),
    ];
    const model = new FakeModel('fallback', script);
    const eventId = s.db.addEvent(fixture('inbound-text'));

    await processWebhookEvent({ ...s.deps, model }, eventId);

    // Three model rounds → three agent_turns.
    expect(s.db.agentTurns).toHaveLength(3);
    expect(s.db.agentTurns[0]?.tool_calls).toMatchObject([{ name: 'capture_customer', ok: true }]);
    expect(s.db.agentTurns[1]?.tool_calls).toMatchObject([{ name: 'create_order', ok: true }]);
    expect(s.db.agentTurns[2]?.tool_calls).toEqual([]);
    // Only the final round attaches to the outbound message.
    expect(s.db.agentTurns[0]?.message_id).toBeNull();
    expect(s.db.agentTurns[2]?.message_id).not.toBeNull();

    expect(s.db.customers[0]).toMatchObject({ name: 'Ana Pérez', city: 'Bogotá' });
    expect(s.db.orders).toHaveLength(1);
    expect(s.db.orders[0]).toMatchObject({
      conversation_id: s.conversation.id,
      customer_id: s.customer.id,
      total: 110000,
      source: 'agent',
    });
    expect(s.db.orderItems.map((i) => i.sort_order)).toEqual([0]);
    // The D2 trigger equivalent ran.
    expect(s.db.customers[0]?.total_spent).toBe(110000);

    expect(s.sender.sent).toHaveLength(1);
    expect(s.sender.sent[0]?.body).toContain('Ana');
  });

  it('handoff: conversation flagged and paused, configured message sent, loop stops', async () => {
    const s = setup([], { escalation: { handoffMessage: 'Ya te contacta el equipo.' } });
    const model = new FakeModel('fallback', [
      toolCallTurn({ name: 'handoff_to_human', args: { reason: 'human_request' } }),
      textTurn('must not run'),
    ]);
    const eventId = s.db.addEvent(fixture('inbound-text'));

    await processWebhookEvent({ ...s.deps, model }, eventId);

    expect(model.roundsRun).toBe(1);
    expect(s.conversation.needs_attention).toBe(true);
    expect(s.conversation.bot_paused).toBe(true);
    expect(s.conversation.paused_until).toBeNull();
    expect(s.sender.sent[0]?.body).toBe('Ya te contacta el equipo.');
    expect(s.db.agentTurns).toHaveLength(1);
  });

  it('round ceiling: real handoff — flags + pauses, sends message, marks the turn (ws-r3 §0)', async () => {
    const s = setup([], { escalation: { handoffMessage: 'Te paso con el equipo.' } });
    const model = new FakeModel(
      'fallback',
      Array.from({ length: MAX_MODEL_ROUNDS + 2 }, () =>
        toolCallTurn({ name: 'check_catalog', args: {} }),
      ),
    );
    const eventId = s.db.addEvent(fixture('inbound-text'));

    await processWebhookEvent({ ...s.deps, model }, eventId);

    expect(model.roundsRun).toBe(MAX_MODEL_ROUNDS);
    expect(s.db.agentTurns).toHaveLength(MAX_MODEL_ROUNDS);
    // The customer is never left with silence.
    expect(s.sender.sent).toHaveLength(1);
    expect(s.sender.sent[0]?.body).toBe('Te paso con el equipo.');
    // ws-r3 §0: the ceiling now performs a real handoff (R2 Q-E defect).
    expect(s.conversation.needs_attention).toBe(true);
    expect(s.conversation.bot_paused).toBe(true);
    expect(s.conversation.paused_until).toBeNull();
    // The last turn carries the distinct ceiling-handoff marker.
    expect(s.db.agentTurns.at(-1)?.error).toEqual({ reason: 'round_limit_handoff' });
  });

  it('a paused conversation never runs tools', async () => {
    const s = setup([], { orders: { enabled: true, confirmBeforeCreate: false } });
    s.conversation.bot_paused = true;
    s.conversation.paused_until = null;
    const model = new FakeModel('fallback', [
      toolCallTurn({
        name: 'create_order',
        args: { items: [{ product_id: s.product.id, qty: 1 }] },
      }),
    ]);
    const eventId = s.db.addEvent(fixture('inbound-text'));

    await processWebhookEvent({ ...s.deps, model }, eventId);

    expect(model.roundsRun).toBe(0);
    expect(s.db.orders).toHaveLength(0);
    expect(s.db.agentTurns[0]?.error).toMatchObject({ reason: 'bot_paused' });
  });

  it('outside the 24h window nothing runs — no tool writes, no send', async () => {
    const s = setup([], { orders: { enabled: true, confirmBeforeCreate: false } });
    s.conversation.last_customer_message_at = new Date(Date.now() - 48 * 3_600_000).toISOString();

    const raw = JSON.parse(JSON.stringify(fixture('inbound-text'))) as {
      entry: { changes: { value: { messages: { id: string }[] } }[] }[];
    };
    const wamid = raw.entry[0]!.changes[0]!.value.messages[0]!.id;
    await s.db.createTenantRepo(TENANT.id).insertMessage({
      conversation_id: s.conversation.id,
      wa_message_id: wamid,
      direction: 'inbound',
      source: 'customer',
      type: 'text',
      body: 'hola',
    });

    const model = new FakeModel('fallback', [
      toolCallTurn({
        name: 'create_order',
        args: { items: [{ product_id: s.product.id, qty: 1 }] },
      }),
    ]);
    const eventId = s.db.addEvent(fixture('inbound-text'));

    await processWebhookEvent({ ...s.deps, model }, eventId);

    expect(model.roundsRun).toBe(0);
    expect(s.db.orders).toHaveLength(0);
    expect(s.sender.sent).toHaveLength(0);
    expect(s.db.agentTurns[0]?.error).toMatchObject({ reason: 'outside_24h_window' });
  });

  it('a tenant with no products is not offered catalog or order tools', async () => {
    const s = setup([], { orders: { enabled: true } });
    s.db.products.length = 0;
    const model = new FakeModel('fallback', [textTurn('Hola.')]);
    const eventId = s.db.addEvent(fixture('inbound-text'));

    await processWebhookEvent({ ...s.deps, model }, eventId);

    const offered = model.calls[0]?.tools?.map((t) => t.name) ?? [];
    expect(offered).toEqual(['capture_customer', 'handoff_to_human']);
  });
});

describe('media handling (ws-r2 §5)', () => {
  it('an inbound image still gets a text turn, with tools available', async () => {
    const s = setup([], {
      escalation: { rules: [{ trigger: 'payment_proof' }], handoffMessage: 'Reviso tu pago.' },
    });
    const model = new FakeModel('fallback', [
      toolCallTurn({ name: 'handoff_to_human', args: { reason: 'payment_proof' } }),
    ]);
    const eventId = s.db.addEvent(fixture('inbound-image'));

    await processWebhookEvent({ ...s.deps, model }, eventId);

    // The image reaches the model as a placeholder (no OCR, nothing read).
    expect(JSON.stringify(model.calls[0]?.history)).toContain('[imagen]');
    expect(s.conversation.needs_attention).toBe(true);
    expect(s.sender.sent[0]?.body).toBe('Reviso tu pago.');
  });

  it('audio still skips before any tool runs (R1 behavior unchanged)', async () => {
    // The audio fixture is addressed to the second seeded tenant, so it needs
    // its own registration rather than the shared one.
    const db = new FakeDb();
    db.addTenant({
      tenant: { ...TENANT, id: 'bb000000-0001-4000-8000-000000000001', name: 'Sabor Casero' },
      phoneNumberId: '222000222000222',
    });
    const model = new FakeModel('fallback', [textTurn('should not run')]);
    const eventId = db.addEvent(fixture('inbound-audio'));

    await processWebhookEvent({ db, model, sender: new MockWaSender(), log: () => {} }, eventId);

    expect(model.roundsRun).toBe(0);
    expect(db.agentTurns[0]?.error).toMatchObject({ reason: 'audio_not_supported' });
  });
});
