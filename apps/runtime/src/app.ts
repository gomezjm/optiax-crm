/**
 * Hono app (spec §1):
 *  - POST /webhooks/wa — verify signature → log webhook_events → enqueue → 200.
 *    Invalid signature → 401, nothing stored. Tenant resolution is best-effort
 *    here (nullable on the event row); the worker does it authoritatively.
 *  - GET /health — 200 + version.
 */
import { createRequire } from 'node:module';
import { Hono } from 'hono';
import { verifyWebhookSignature, WEBHOOK_SIGNATURE_HEADER, type Json } from '@optiax/shared';
import type { RuntimeDb } from './db/index.js';
import { parseEnvelope } from './wa/envelope.js';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

export interface AppDeps {
  db: RuntimeDb;
  /** Overrides the WEBHOOK_SECRET env fallback inside verifyWebhookSignature. */
  webhookSecret?: string;
  log?: (message: string) => void;
}

export function createApp(deps: AppDeps): Hono {
  const { db, webhookSecret, log = console.log } = deps;
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true, version }));

  app.post('/webhooks/wa', async (c) => {
    const rawBody = await c.req.text();
    const signature = c.req.header(WEBHOOK_SIGNATURE_HEADER) ?? '';
    if (!verifyWebhookSignature(rawBody, signature, webhookSecret)) {
      return c.json({ ok: false, error: 'invalid signature' }, 401);
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
