# 360dialog webhook fixtures

360dialog forwards webhooks in **Meta Cloud API format**:
`{ object, entry: [{ id, changes: [{ value: { messaging_product, metadata, contacts?, messages?, statuses?, ... }, field }] }] }`.

## Provenance

On 2026-07-19 real **sandbox** deliveries were captured (`scripts/capture-webhook.ts`,
runbook: `docs/runbooks/capture-360dialog-webhook.md`; raw captures live in the
gitignored `captures/360dialog/`). The fixtures below were corrected against those
captures. Rules that stand:

- **Captured-verified fixtures are never hand-edited again.** If a shape turns out
  to be wrong, capture a new payload; don't patch by hand.
- The only deltas vs the raw captures are identity swaps: `phone_number_id`,
  display/wa phone numbers, `wamid`s, `entry[].id`, `user_id`s and
  `conversation.id`s are replaced with the seed-tenant synthetic values so tests
  keep working. Structure and value formats are the captured ones.
- Payloads are kept clean on purpose — no annotation/comment keys inside the JSON.
  Anything worth explaining lives in this README.

Captured-confirmed facts worth knowing:

- Contacts carry a `user_id` (`"VE.1470891188060290"` — country-prefixed) and
  messages a matching `from_user_id`; statuses carry `recipient_user_id`.
  Fixtures use synthetic `CO.*` values. Our parser ignores all three.
- **Status deliveries include a `contacts` array too** (`{ wa_id, user_id }`, no
  `profile`) — earlier reconstructions omitted it.
- `read` statuses DO carry `conversation` + `pricing` (earlier reconstruction
  omitted them). `conversation.expiration_timestamp` appears on `sent` only —
  and, sandbox quirk, it **equals `timestamp`** rather than +24h.
- `conversation.id` is a 32-char hex string (not a `conv.*` slug).
- Sandbox pricing is `{ billable: false, pricing_model: "PMP", category:
  "service", type: "free_customer_service" }`. Paid/production conversations
  will differ — unverified.
- The sandbox is the On-Premise API surface (`waba-sandbox.360dialog.io/v1`)
  but forwards Meta-Cloud-shaped envelopes; production Cloud API transport is
  re-verified in Phase 4.

## Tenant mapping

Fixtures use two `phone_number_id`s matching the two seed tenants (`supabase/seed.sql`):

| `phone_number_id` | Display number | Seed tenant |
|---|---|---|
| `111000111000111` | `573001112233` | Moda Valentina (retail) |
| `222000222000222` | `573004445566` | Sabor Casero (food) |

## Files

| File | Event | Status |
|---|---|---|
| `inbound-text.json` | Customer text message (product question) | **captured-verified** |
| `inbound-image.json` | Image with caption — the payment-proof case | reconstruction (envelope captured-verified; `image` media object unverified) |
| `inbound-audio.json` | Voice note (`voice: true`) | reconstruction (envelope captured-verified; `audio` media object unverified) |
| `status-sent.json` | Outbound message sent (only status carrying `conversation.expiration_timestamp`) | **captured-verified** |
| `status-delivered.json` | Outbound message delivered | **captured-verified** |
| `status-read.json` | Outbound message read | **captured-verified** |
| `status-failed.json` | Outbound failed (error 131047 — outside 24h window) | reconstruction (status envelope aligned with captured sent/delivered/read; `errors[]` unverified — sandbox produced no failure) |
| `echo-owner-reply.json` | `smb_message_echoes` — owner replied from the WhatsApp Business app (coexistence pause trigger) | reconstruction — coexistence-only, the sandbox cannot emit it |
| `history-sync.json` | Coexistence contact/history import chunk | reconstruction — coexistence-only, the sandbox cannot emit it |

The two coexistence reconstructions stay exactly as authored from Meta's docs. One
structural implication from the captures: since every real contact/message carried
`user_id`/`from_user_id`, real echo/history payloads likely do too — treat those
fields as optional everywhere, and re-verify when a coexistence number is onboarded
(runbook, last section).

## Signature / transport (captured reality)

**360dialog does not sign deliveries.** All captured requests carried **no
signature header of any kind**. Authentication is possession of the secret webhook
URL; Basic auth embedded in the registered URL arrives as `Authorization: Basic …`,
and custom headers configured at registration are forwarded verbatim (both probed
and confirmed). Requests come from `python-httpx`, `content-type: application/json`.

The HMAC `x-webhook-signature` scheme in
`packages/shared/src/webhook-signature.ts` is therefore a **local-dev stub**, kept
for `pnpm simulate` and tests. The runtime's `WEBHOOK_VERIFY` env
(`stub` | `360dialog` | `off`, default `stub`) makes the route's behavior explicit
— see `apps/runtime/src/env.ts`. TODO(Phase 4): confirm the production scheme
(possibly Meta-style `X-Hub-Signature-256`) against real onboarded-number
deliveries.

## Simulator

```bash
pnpm simulate inbound-text            # POSTs to http://localhost:8787/webhooks/wa
pnpm simulate status-failed --port 3001
```

The simulator signs the raw body with the **stub** HMAC scheme
(`x-webhook-signature` header), matching the runtime's default
`WEBHOOK_VERIFY=stub` mode.
