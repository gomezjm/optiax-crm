/**
 * The dashboard→runtime endpoints (ws-d3 §1, §2, §5), unit-level: FakeDb +
 * FakeModel + a fake authenticator, no network. Covers auth rejection, the
 * Playground's non-persistence guarantee, the rate limit, and the publish gate's
 * admin gating + pass/fail behavior. The atomic pointer flip against real
 * Postgres is covered by test/integration/publish.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { RETAIL_CONFIG } from '@optiax/shared/evals';
import type { AgentConfig } from '@optiax/shared';
import { createApp } from '../src/app.js';
import { FakeModel, textTurn, toolCallTurn } from '../src/model/fake.js';
import { deterministicOptions } from '../src/evals/evaluate.js';
import type { Authenticator, AuthContext } from '../src/db/index.js';
import type { RateLimiter } from '../src/http/rate-limit.js';
import { FakeDb, makeAgentConfig } from './fakes.js';

const TENANT = {
  id: 'aa000000-0001-4000-8000-000000000001',
  name: 'Moda Valentina',
  agentEnabled: true,
  activePromptVersionId: 'pv-1',
  timezone: 'America/Bogota',
  currency: 'COP',
};
const PHONE = '111000111000111';

/** Maps opaque test tokens to auth contexts; anything else is rejected. */
function fakeAuthenticator(tokens: Record<string, AuthContext>): Authenticator {
  return { authenticate: (token) => Promise.resolve(tokens[token] ?? null) };
}

const ADMIN: AuthContext = { userId: 'u-admin', tenantId: TENANT.id, role: 'admin' };
const REP: AuthContext = { userId: 'u-rep', tenantId: TENANT.id, role: 'sales_rep' };

function buildApp(opts: {
  db: FakeDb;
  model?: FakeModel;
  rateLimiter?: RateLimiter;
  tokens?: Record<string, AuthContext>;
}) {
  return createApp({
    db: opts.db,
    log: () => {},
    api: {
      db: opts.db,
      authenticator: fakeAuthenticator(opts.tokens ?? { 'admin-token': ADMIN, 'rep-token': REP }),
      playgroundModel: opts.model ?? new FakeModel('Hola 👋'),
      evaluateOptions: deterministicOptions(),
      corsOrigin: 'http://localhost:3000',
      ...(opts.rateLimiter ? { rateLimiter: opts.rateLimiter } : {}),
    },
  });
}

function post(app: ReturnType<typeof createApp>, path: string, token: string | null, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('POST /playground', () => {
  function setup() {
    const db = new FakeDb();
    db.addTenant({ tenant: TENANT, phoneNumberId: PHONE });
    db.addOrderStatus(TENANT.id, 'Nuevo', 'new');
    const product = db.addProduct({ tenant_id: TENANT.id, name: 'Blusa blanca', price: 55000 });
    const config = makeAgentConfig(
      {},
      { orders: { enabled: true, confirmBeforeCreate: false, collectDelivery: false, sharePaymentMethods: false } },
    );
    return { db, product, config };
  }

  it('rejects a request with no token', async () => {
    const { db, config } = setup();
    const app = buildApp({ db });
    const res = await post(app, '/playground', null, { config, messages: [], newMessage: 'hola' });
    expect(res.status).toBe(401);
  });

  it('rejects an unknown token', async () => {
    const { db, config } = setup();
    const app = buildApp({ db });
    const res = await post(app, '/playground', 'nope', { config, messages: [], newMessage: 'hola' });
    expect(res.status).toBe(401);
  });

  it('returns a reply plus the would-be tool actions and persists nothing', async () => {
    const { db, product, config } = setup();
    // Script the loop to check the catalog, create an order, then reply.
    const model = new FakeModel('fallback', [
      toolCallTurn({ name: 'check_catalog', args: { query: 'blusa' } }),
      toolCallTurn({
        name: 'create_order',
        args: { items: [{ product_id: product.id, qty: 2 }], confirmed: true },
      }),
      textTurn('¡Listo! Te dejo el pedido separado.'),
    ]);
    const app = buildApp({ db, model });

    const res = await post(app, '/playground', 'admin-token', {
      config,
      messages: [{ role: 'user', text: 'Quiero una blusa' }],
      newMessage: 'Confirmo, dos por favor',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      reply: string;
      toolCalls: { name: string; ok: boolean; result: { total?: number } }[];
    };
    expect(body.reply).toBe('¡Listo! Te dejo el pedido separado.');

    const order = body.toolCalls.find((t) => t.name === 'create_order');
    expect(order?.ok).toBe(true);
    expect(order?.result.total).toBe(110000); // 2 × 55000, priced from the real catalog

    // The whole point: nothing the Playground did touched the tenant's data.
    expect(db.orders).toHaveLength(0);
    expect(db.orderItems).toHaveLength(0);
    expect(db.messages).toHaveLength(0);
    expect(db.agentTurns).toHaveLength(0);
    expect(db.customers).toHaveLength(0);
  });

  it('rate-limits per tenant', async () => {
    const { db, config } = setup();
    const app = buildApp({ db, rateLimiter: { tryConsume: () => false } });
    const res = await post(app, '/playground', 'admin-token', { config, messages: [], newMessage: 'hola' });
    expect(res.status).toBe(429);
  });

  it('400s an invalid request body', async () => {
    const { db } = setup();
    const app = buildApp({ db });
    const res = await post(app, '/playground', 'admin-token', { config: { version: 1 }, newMessage: '' });
    expect(res.status).toBe(400);
  });
});

describe('POST /publish', () => {
  function setup(draft: AgentConfig) {
    const db = new FakeDb();
    db.addTenant({ tenant: TENANT, phoneNumberId: PHONE, config: RETAIL_CONFIG, draftConfig: draft });
    return db;
  }

  it('forbids a sales_rep', async () => {
    const db = setup(RETAIL_CONFIG);
    const app = buildApp({ db });
    const res = await post(app, '/publish', 'rep-token', {});
    expect(res.status).toBe(403);
  });

  it('publishes a draft that passes the gate', async () => {
    const db = setup(RETAIL_CONFIG);
    const app = buildApp({ db });
    const res = await post(app, '/publish', 'admin-token', {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { published: boolean; versionId?: string };
    expect(body.published).toBe(true);
    expect(body.versionId).toBeTruthy();
  });

  it('blocks a draft that fails the gate and publishes nothing', async () => {
    // Orders disabled → the happy-path fixture's create_order is refused, so its
    // order_count check fails and the gate blocks.
    const broken: AgentConfig = { ...RETAIL_CONFIG, orders: { ...RETAIL_CONFIG.orders, enabled: false } };
    const db = setup(broken);
    const app = buildApp({ db });
    const res = await post(app, '/publish', 'admin-token', {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { published: boolean; reason?: string; evaluation: { pass: boolean } };
    expect(body.published).toBe(false);
    expect(body.reason).toBe('gate_failed');
    expect(body.evaluation.pass).toBe(false);
  });

  it('409s when there is no draft to publish', async () => {
    const db = new FakeDb();
    db.addTenant({ tenant: TENANT, phoneNumberId: PHONE, config: RETAIL_CONFIG, draftConfig: null });
    const app = buildApp({ db });
    const res = await post(app, '/publish', 'admin-token', {});
    expect(res.status).toBe(409);
  });
});

describe('POST /publish/evaluate', () => {
  it('forbids a sales_rep', async () => {
    const db = new FakeDb();
    db.addTenant({ tenant: TENANT, phoneNumberId: PHONE, config: RETAIL_CONFIG, draftConfig: RETAIL_CONFIG });
    const app = buildApp({ db });
    const res = await post(app, '/publish/evaluate', 'rep-token', {});
    expect(res.status).toBe(403);
  });

  it('returns the evaluation without publishing', async () => {
    const db = new FakeDb();
    db.addTenant({ tenant: TENANT, phoneNumberId: PHONE, config: RETAIL_CONFIG, draftConfig: RETAIL_CONFIG });
    const app = buildApp({ db });
    const res = await post(app, '/publish/evaluate', 'admin-token', {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pass: boolean; cases: unknown[] };
    expect(body.pass).toBe(true);
    expect(Array.isArray(body.cases)).toBe(true);
  });
});
