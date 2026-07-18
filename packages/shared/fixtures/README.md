# 360dialog webhook fixtures

360dialog forwards webhooks in **Meta Cloud API format**:
`{ entry: [{ changes: [{ field, value: { messaging_product, metadata, contacts?, messages?, statuses?, ... } }] }] }`.

## ⚠️ Provenance

These payloads are **reconstructions built from Meta's Cloud API webhook documentation** —
they have never touched a real 360dialog sandbox.

- **Replace them with captured sandbox payloads** (Juan's action item).
- After they are replaced with captures: **never hand-edit them again.** If a shape turns
  out to be wrong, capture a new payload; don't patch by hand.
- Payloads are kept clean on purpose — no annotation/comment keys inside the JSON.
  Anything worth explaining lives in this README.

## Tenant mapping

Fixtures use two `phone_number_id`s matching the two seed tenants (`supabase/seed.sql`):

| `phone_number_id` | Display number | Seed tenant |
|---|---|---|
| `111000111000111` | `573001112233` | Moda Valentina (retail) |
| `222000222000222` | `573004445566` | Sabor Casero (food) |

## Files

| File | Event |
|---|---|
| `inbound-text.json` | Customer text message (product question) |
| `inbound-image.json` | Image with caption — the payment-proof case |
| `inbound-audio.json` | Voice note (`voice: true`) |
| `status-delivered.json` | Outbound message delivered |
| `status-read.json` | Outbound message read |
| `status-failed.json` | Outbound failed (error 131047 — outside 24h window) |
| `echo-owner-reply.json` | `smb_message_echoes` — owner replied from the WhatsApp Business app (coexistence pause trigger) |
| `history-sync.json` | Coexistence contact/history import chunk |

## Simulator

```bash
pnpm simulate inbound-text            # POSTs to http://localhost:8787/webhook
pnpm simulate status-failed --port 3001
```

The simulator signs the raw body with the **stub** HMAC scheme in
`packages/shared/src/webhook-signature.ts` (`x-webhook-signature` header). The real
360dialog signing scheme is unconfirmed; when it is known, swap the internals of
`signWebhookPayload`/`verifyWebhookSignature` and nothing else changes.
