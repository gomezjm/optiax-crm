# apps/runtime

Hono service + pgmq worker in one process (`pnpm dev`). The Phase 1 walking
skeleton: `POST /webhooks/wa` verifies the signature, logs `webhook_events`,
enqueues to `wa_inbound`; the worker resolves the tenant, dedupes on
`wa_message_id`, calls the model, persists messages + `agent_turns`, sends via
the (mock) WhatsApp sender.

## Do

- Import every type/schema from `@optiax/shared`.
- DB access **only through `src/db/`** (tenant-scoped repository module). The
  raw service client is module-private there — enforced by eslint
  `no-restricted-imports` and `test/import-restriction.test.ts`.
- Keep the pipeline provider-agnostic: models implement `AgentModel`
  (`src/model/types.ts`), senders implement `WaSender` (`src/wa/sender.ts`).
- Automated tests use `FakeModel` — never call Gemini or any network in tests.
- Reach the queue only through the `public.wa_inbound_*` RPC wrappers
  (migration 7), via `db.queue`.

## Don't

- Don't redeclare DB row types or config schemas here.
- Don't import `@supabase/supabase-js` outside `src/db/` (CI fails).
- Don't put per-message logic in Supabase Edge Functions; it lives here.
- Don't add pause-setting/24h-gating/tools/audio-transcription logic — those
  are R1/R2 workstreams. This phase only *checks* `bot_paused`/`agent_enabled`.
