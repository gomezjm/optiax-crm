/**
 * Runtime entrypoint: Hono server + pgmq worker in one process for now
 * (separable later per the scaling path).
 */
import { serve } from '@hono/node-server';
import { loadEnv } from './env.js';
import { createDb } from './db/index.js';
import { createApp } from './app.js';
import { startWorker } from './worker/worker.js';
import { GeminiModel } from './model/gemini.js';
import { FakeModel } from './model/fake.js';
import type { AgentModel } from './model/types.js';
import { createWaSender } from './wa/sender.js';

const env = loadEnv();
const db = createDb({ url: env.supabaseUrl, serviceRoleKey: env.supabaseServiceRoleKey });

let model: AgentModel;
if (env.geminiApiKey) {
  model = new GeminiModel({ apiKey: env.geminiApiKey, modelId: env.geminiModelId });
  console.log(`[runtime] model: ${env.geminiModelId}`);
} else {
  model = new FakeModel();
  console.warn('[runtime] GEMINI_API_KEY not set — using FakeModel (canned replies)');
}

const sender = createWaSender(env.waSender);
const app = createApp({ db, ...(env.webhookSecret ? { webhookSecret: env.webhookSecret } : {}) });

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`[runtime] listening on http://localhost:${info.port}`);
});
const worker = startWorker({ db, model, sender });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void worker.stop().finally(() => process.exit(0));
  });
}
