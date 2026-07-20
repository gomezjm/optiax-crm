import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { signWebhookPayload, WEBHOOK_SIGNATURE_HEADER } from '@optiax/shared/webhook';
import { createApp, type AppDeps } from '../src/app.js';
import { FakeDb } from './fakes.js';

const FIXTURE_RAW = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../packages/shared/fixtures/360dialog/inbound-text.json',
  ),
  'utf8',
);

function setup(overrides: Partial<AppDeps> = {}) {
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
  const app = createApp({ db, log: () => {}, ...overrides });
  return { db, app };
}

function post(app: ReturnType<typeof setup>['app'], headers: Record<string, string> = {}) {
  return app.request('/webhooks/wa', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: FIXTURE_RAW,
  });
}

describe('POST /webhooks/wa — WEBHOOK_VERIFY modes', () => {
  it("default 'stub': accepts a stub-signed request, stores + queues the event", async () => {
    const { db, app } = setup();
    const res = await post(app, { [WEBHOOK_SIGNATURE_HEADER]: signWebhookPayload(FIXTURE_RAW) });
    expect(res.status).toBe(200);
    expect(db.events.size).toBe(1);
    expect(db.queueMessages).toHaveLength(1);
  });

  it("default 'stub': rejects an unsigned request with 401, nothing stored", async () => {
    const { db, app } = setup();
    const res = await post(app);
    expect(res.status).toBe(401);
    expect(db.events.size).toBe(0);
    expect(db.queueMessages).toHaveLength(0);
  });

  // Captured sandbox reality: 360dialog deliveries carry no signature header,
  // so '360dialog' mode must accept unsigned requests.
  it("'360dialog': accepts an unsigned request", async () => {
    const { db, app } = setup({ webhookVerify: '360dialog' });
    const res = await post(app);
    expect(res.status).toBe(200);
    expect(db.events.size).toBe(1);
    expect(db.queueMessages).toHaveLength(1);
  });

  it("'off': accepts an unsigned request", async () => {
    const { db, app } = setup({ webhookVerify: 'off' });
    const res = await post(app);
    expect(res.status).toBe(200);
    expect(db.events.size).toBe(1);
  });
});
