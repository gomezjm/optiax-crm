/**
 * The dashboard→runtime routes (ws-d3 §1–§2, §5) — the only runtime endpoints
 * besides the webhook. All three verify the Supabase access token and scope by
 * the token's claims; none ever trusts a tenant id from the body.
 *
 *   POST /playground        — run one draft-mode turn, persist nothing (any member)
 *   POST /publish/evaluate  — dry-run the publish gate (admin only)
 *   POST /publish           — gate → compile → flip the active pointer (admin only)
 *
 * Kept in its own module so `createApp` stays about the webhook; these reuse the
 * tool loop and the R3 gate, they do not fork them.
 */
import type { Hono } from 'hono';
import { cors } from 'hono/cors';
import { PlaygroundRequestSchema } from '@optiax/shared';
import type { Authenticator, AuthContext, RuntimeDb } from '../db/index.js';
import type { AgentModel } from '../model/types.js';
import type { EvaluateOptions } from '../evals/evaluate.js';
import { runPlayground } from '../playground/playground.js';
import { NoDraftError, runEvaluate, runPublish } from '../publish/publish.js';
import { createRateLimiter, type RateLimiter } from './rate-limit.js';

export interface ApiRouteDeps {
  db: RuntimeDb;
  authenticator: Authenticator;
  /** Conversation model for the Playground (real Gemini in prod). */
  playgroundModel: AgentModel;
  /** Model layer for the publish gate (real Gemini in prod, deterministic in tests). */
  evaluateOptions: EvaluateOptions;
  /** CORS allow-list for the dashboard origin(s). */
  corsOrigin: string | string[];
  /** Per-tenant Playground rate limiter. A default is created when omitted. */
  rateLimiter?: RateLimiter;
  log?: (message: string) => void;
}

/** Pull and verify the bearer token; null when missing or invalid. */
async function resolveAuth(
  authHeader: string | undefined,
  authenticator: Authenticator,
): Promise<AuthContext | null> {
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return null;
  return authenticator.authenticate(token);
}

export function mountApiRoutes(app: Hono, deps: ApiRouteDeps): void {
  const log = deps.log ?? console.log;
  // Default: 5-message burst, one new token every 6s (~10/min) per tenant.
  const rateLimiter =
    deps.rateLimiter ?? createRateLimiter({ capacity: 5, refillPerSecond: 1 / 6 });
  const corsMw = cors({ origin: deps.corsOrigin, allowHeaders: ['Authorization', 'Content-Type'] });

  app.use('/playground', corsMw);
  app.use('/publish', corsMw);
  app.use('/publish/evaluate', corsMw);

  app.post('/playground', async (c) => {
    const auth = await resolveAuth(c.req.header('Authorization'), deps.authenticator);
    if (!auth) return c.json({ error: 'unauthorized' }, 401);

    if (!rateLimiter.tryConsume(auth.tenantId)) {
      return c.json({ error: 'rate_limited' }, 429);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    const parsed = PlaygroundRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: 'invalid_request',
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
        400,
      );
    }

    try {
      const result = await runPlayground(
        { db: deps.db, model: deps.playgroundModel, log },
        auth.tenantId,
        parsed.data,
      );
      return c.json(result);
    } catch (err) {
      log(`[playground] tenant=${auth.tenantId} failed: ${String(err)}`);
      return c.json({ error: 'playground_failed' }, 502);
    }
  });

  app.post('/publish/evaluate', async (c) => {
    const auth = await resolveAuth(c.req.header('Authorization'), deps.authenticator);
    if (!auth) return c.json({ error: 'unauthorized' }, 401);
    if (auth.role !== 'admin') return c.json({ error: 'forbidden' }, 403);

    try {
      const evaluation = await runEvaluate({ db: deps.db, options: deps.evaluateOptions }, auth.tenantId);
      return c.json(evaluation);
    } catch (err) {
      if (err instanceof NoDraftError) return c.json({ error: 'no_draft' }, 409);
      log(`[publish/evaluate] tenant=${auth.tenantId} failed: ${String(err)}`);
      return c.json({ error: 'evaluate_failed' }, 502);
    }
  });

  app.post('/publish', async (c) => {
    const auth = await resolveAuth(c.req.header('Authorization'), deps.authenticator);
    if (!auth) return c.json({ error: 'unauthorized' }, 401);
    if (auth.role !== 'admin') return c.json({ error: 'forbidden' }, 403);

    try {
      const result = await runPublish({ db: deps.db, options: deps.evaluateOptions }, auth.tenantId);
      return c.json(result);
    } catch (err) {
      if (err instanceof NoDraftError) return c.json({ error: 'no_draft' }, 409);
      log(`[publish] tenant=${auth.tenantId} failed: ${String(err)}`);
      return c.json({ error: 'publish_failed' }, 502);
    }
  });
}
