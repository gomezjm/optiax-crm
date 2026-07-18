# apps/runtime

Hono service. Phase 0: a stub — `/health` and `/webhook` (signature check + ack) so
`pnpm simulate` has a target. Phase 1 adds: enqueue to pgmq `wa_inbound`, tenant
resolution by `phone_number_id`, the agent loop, 360dialog send.

## Do

- Import every type/schema from `@optiax/shared`.
- Verify webhook signatures with `verifyWebhookSignature` (stub scheme — swap its
  internals when the real 360dialog scheme is confirmed; call sites don't change).
- DB access (Phase 1): service-role client **only through a tenant-scoped repository
  module**. The raw service client must never be exported from that module.

## Don't

- Don't redeclare DB row types or config schemas here.
- Don't call Gemini or 360dialog in Phase 0 — everything is local + fixtures.
- Don't put per-message logic in Supabase Edge Functions; it lives in this service.
