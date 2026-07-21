/**
 * Hono app (spec §1):
 *  - POST /webhooks/wa — verify per WEBHOOK_VERIFY mode → log webhook_events →
 *    enqueue → 200. Invalid stub signature → 401, nothing stored. Tenant
 *    resolution is best-effort here (nullable on the event row); the worker
 *    does it authoritatively.
 *  - GET /health — 200 + version.
 */
import { createRequire } from 'node:module';
import { Hono } from 'hono';
import type { Json } from '@optiax/shared';
import { verifyWebhookSignature, WEBHOOK_SIGNATURE_HEADER } from '@optiax/shared/webhook';
import type { RuntimeDb } from './db/index.js';
import type { WebhookVerifyMode } from './env.js';
import { parseEnvelope } from './wa/envelope.js';
import { mountApiRoutes, type ApiRouteDeps } from './http/api-routes.js';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

export interface AppDeps {
  db: RuntimeDb;
  /** Overrides the WEBHOOK_SECRET env fallback inside verifyWebhookSignature. */
  webhookSecret?: string;
  /** See WebhookVerifyMode in env.ts. Default 'stub'. */
  webhookVerify?: WebhookVerifyMode;
  /**
   * Enables the dashboard→runtime routes (/playground, /publish[/evaluate]).
   * Omitted by the webhook-only test harnesses; supplied by the real entrypoint.
   */
  api?: ApiRouteDeps;
  log?: (message: string) => void;
}

export function createApp(deps: AppDeps): Hono {
  const { db, webhookSecret, webhookVerify = 'stub', log = console.log } = deps;
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true, version }));

  if (deps.api) mountApiRoutes(app, deps.api);

  app.post('/webhooks/wa', async (c) => {
    const rawBody = await c.req.text();
    // '360dialog' and 'off' accept unsigned requests: captured sandbox
    // deliveries carry no signature header (fixtures/README.md), so there is
    // nothing to verify at the app layer — transport auth is the secret URL /
    // Basic auth enforced at the edge. TODO(Phase 4): confirm against
    // production deliveries and implement whatever scheme they carry.
    if (webhookVerify === 'stub') {
      const signature = c.req.header(WEBHOOK_SIGNATURE_HEADER) ?? '';
      if (!verifyWebhookSignature(rawBody, signature, webhookSecret)) {
        return c.json({ ok: false, error: 'invalid signature' }, 401);
      }
    }

    let payload: Json;
    try {
      payload = JSON.parse(rawBody) as Json;
    } catch {
      return c.json({ ok: false, error: 'invalid JSON' }, 400);
    }

    const envelope = parseEnvelope(payload);
    const tenant = envelope.phoneNumberId
      ? await db.resolveTenantByPhoneNumberId(envelope.phoneNumberId)
      : null;

    const webhookEventId = await db.webhookEvents.insert({
      eventType: envelope.field ?? 'unknown',
      payload,
      tenantId: tenant?.id ?? null,
    });
    await db.queue.send({ webhook_event_id: webhookEventId });

    log(`[webhook] event ${webhookEventId} queued (tenant=${tenant?.name ?? 'unresolved'})`);
    return c.json({ ok: true, eventId: webhookEventId });
  });

  return app;
}
