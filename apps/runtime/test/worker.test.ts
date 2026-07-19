import { describe, expect, it } from 'vitest';
import { drainQueueOnce, MAX_READS } from '../src/worker/worker.js';
import { FakeModel } from '../src/model/fake.js';
import { MockWaSender } from '../src/wa/sender.js';
import { FakeDb } from './fakes.js';

function deps(db: FakeDb) {
  return { db, model: new FakeModel(), sender: new MockWaSender(), log: () => {} };
}

/** An event whose payload the pipeline will choke on is simulated by pointing
 *  the queue at an event id that exists but whose processing throws: easiest
 *  deterministic failure is a DB-level one, so we make webhookEvents.get throw. */
describe('drainQueueOnce', () => {
  it('archives malformed queue payloads immediately', async () => {
    const db = new FakeDb();
    const msgId = db.enqueue({ nonsense: true });

    const handled = await drainQueueOnce(deps(db));

    expect(handled).toBe(1);
    expect(db.archived).toEqual([msgId]);
  });

  it('leaves a failing message for retry while read_ct < MAX_READS', async () => {
    const db = new FakeDb();
    const eventId = db.addEvent({});
    db.webhookEvents.get = () => Promise.reject(new Error('db down'));
    const msgId = db.enqueue({ webhook_event_id: eventId }, 1);

    const handled = await drainQueueOnce(deps(db));

    expect(handled).toBe(0);
    expect(db.archived).not.toContain(msgId);
  });

  it(`poison guard: archives + records error after ${MAX_READS} reads`, async () => {
    const db = new FakeDb();
    const eventId = db.addEvent({});
    db.webhookEvents.get = () => Promise.reject(new Error('still broken'));
    const msgId = db.enqueue({ webhook_event_id: eventId }, MAX_READS);

    const handled = await drainQueueOnce(deps(db));

    expect(handled).toBe(1);
    expect(db.archived).toContain(msgId);
    expect(db.events.get(eventId)?.error).toMatchObject({
      reason: 'poison_message',
      read_ct: MAX_READS,
    });
  });

  it('processes a valid message end-to-end and archives it', async () => {
    const db = new FakeDb();
    db.addTenant({
      tenant: {
        id: 'aa000000-0001-4000-8000-000000000001',
        name: 'Moda Valentina',
        agentEnabled: true,
        activePromptVersionId: 'pv-1',
        timezone: 'America/Bogota',
      },
      phoneNumberId: '111000111000111',
    });
    const eventId = db.addEvent({
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '111000111000111' },
                messages: [
                  { id: 'wamid.test.1', from: '573015550101', type: 'text', text: { body: 'hola' } },
                ],
              },
            },
          ],
        },
      ],
    });
    const msgId = db.enqueue({ webhook_event_id: eventId });

    const handled = await drainQueueOnce(deps(db));

    expect(handled).toBe(1);
    expect(db.archived).toEqual([msgId]);
    expect(db.messages).toHaveLength(2);
    expect(db.events.get(eventId)?.processed_at).not.toBeNull();
  });
});
