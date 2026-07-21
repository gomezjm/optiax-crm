/**
 * Env loading for the runtime. No dotenv dependency: reads `.env.local` then
 * `.env` from the app directory (first value wins, real process.env wins over
 * both) — enough for local dev; deploys set real env vars.
 *
 * Local defaults point at `supabase start` with the well-known supabase-demo
 * service_role JWT (same convention as scripts/seed-auth.ts). Local only —
 * production must set every value explicitly.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';
// Well-known supabase-demo service_role JWT shipped with `supabase start`. Local only.
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

function loadDotenvFiles(): void {
  for (const file of ['.env.local', '.env']) {
    let raw: string;
    try {
      raw = readFileSync(resolve(APP_DIR, file), 'utf8');
    } catch {
      continue;
    }
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] ??= value;
    }
  }
}

/**
 * How POST /webhooks/wa authenticates requests:
 *  - 'stub'      — require the local HMAC `x-webhook-signature` (what
 *                  `pnpm simulate` and the test suites send). Default.
 *  - '360dialog' — captured sandbox reality (captures/360dialog/, 2026-07-19):
 *                  deliveries carry NO signature header; authentication is the
 *                  secret webhook URL (+ Basic auth/custom headers configured at
 *                  registration, enforced at the edge, not here). Accepts
 *                  unsigned requests. TODO(Phase 4): confirm against production
 *                  deliveries (possibly Meta-style X-Hub-Signature-256).
 *  - 'off'       — explicit no-verification escape hatch.
 */
export type WebhookVerifyMode = 'stub' | '360dialog' | 'off';

const WEBHOOK_VERIFY_MODES: readonly WebhookVerifyMode[] = ['stub', '360dialog', 'off'];

export interface RuntimeEnv {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  geminiApiKey: string | null;
  geminiModelId: string;
  webhookSecret: string | null;
  webhookVerify: WebhookVerifyMode;
  waSender: 'mock' | '360dialog';
  /** CORS allow-list for the dashboard→runtime routes (ws-d3 §2). */
  dashboardOrigin: string;
  port: number;
}

export function loadEnv(): RuntimeEnv {
  loadDotenvFiles();
  const waSender = process.env.WA_SENDER ?? 'mock';
  if (waSender !== 'mock' && waSender !== '360dialog') {
    throw new Error(`WA_SENDER must be "mock" or "360dialog", got "${waSender}"`);
  }
  const webhookVerify = (process.env.WEBHOOK_VERIFY ?? 'stub') as WebhookVerifyMode;
  if (!WEBHOOK_VERIFY_MODES.includes(webhookVerify)) {
    throw new Error(
      `WEBHOOK_VERIFY must be one of ${WEBHOOK_VERIFY_MODES.join(', ')}, got "${webhookVerify}"`,
    );
  }
  return {
    supabaseUrl: process.env.SUPABASE_URL ?? LOCAL_SUPABASE_URL,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? LOCAL_SERVICE_ROLE_KEY,
    geminiApiKey: process.env.GEMINI_API_KEY ?? null,
    geminiModelId: process.env.GEMINI_MODEL_ID ?? 'gemini-2.5-flash',
    webhookSecret: process.env.WEBHOOK_SECRET ?? null,
    webhookVerify,
    waSender,
    dashboardOrigin: process.env.DASHBOARD_ORIGIN ?? 'http://localhost:3000',
    port: Number(process.env.PORT ?? 8787),
  };
}
