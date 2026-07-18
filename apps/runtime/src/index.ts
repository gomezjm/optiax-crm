/**
 * Placeholder runtime server (Phase 0).
 *
 * The real agent loop arrives in Phase 1. For now this server exists so that
 * `pnpm simulate <fixture>` has something to POST webhook fixtures at:
 *  - GET  /health   → 200 ok
 *  - POST /webhook  → verifies the (stubbed) signature, echoes an ack.
 *
 * No DB access, no Gemini, no 360dialog calls happen here in Phase 0.
 */
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { verifyWebhookSignature } from '@optiax/shared';

const app = new Hono();

app.get('/health', (c) => c.json({ ok: true }));

app.post('/webhook', async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header('x-webhook-signature') ?? '';

  if (!verifyWebhookSignature(rawBody, signature)) {
    return c.json({ ok: false, error: 'invalid signature' }, 401);
  }

  // Phase 1: enqueue to pgmq `wa_inbound` here. Phase 0 just acks.
  return c.json({ ok: true, received: true });
});

const port = Number(process.env.PORT ?? 8787);

// Only start listening when executed directly (not when imported by tests).
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`[runtime] listening on http://localhost:${info.port}`);
  });
}

export { app };
