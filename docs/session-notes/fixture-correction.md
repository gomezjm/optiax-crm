# Fixture-capture correction — Session notes (2026-07-19)

Brief: make fixtures, `envelope.ts`, and signature verification match the real
360dialog **sandbox** deliveries captured in `captures/360dialog/` (7 files,
gitignored: 1 inbound text, 2×sent, 2×delivered, 2×read; runbook
`docs/runbooks/capture-360dialog-webhook.md`). Phase 1 notes moved to
`docs/session-notes/phase-1.md` (same convention as Phase 0).

**Status: done.** Fixtures corrected against captures, `envelope.ts` provenance
updated (no logic change needed — see decision 3), signature reality documented
and made explicit via `WEBHOOK_VERIFY`, all suites green
(`pnpm typecheck` ✓, `pnpm test` 29+unit-shared ✓, `pnpm db:test` 221+5 ✓),
`pnpm simulate inbound-text` verified live end-to-end (real Gemini reply,
mock send), and `WEBHOOK_VERIFY=360dialog` verified live to accept the unsigned
POST shape 360dialog actually sends.

## Diff table: captured vs reconstructed fixtures

Verdicts: **confirmed** (reconstruction already matched), **corrected**
(fixture changed to match capture), **still-unverified** (sandbox could not
produce it). Identity values (`phone_number_id`, phones, wamids, `entry[].id`,
`user_id`s, `conversation.id`s) are swapped to seed-tenant synthetics in
fixtures per the standing rule; the *formats* below refer to captured reality.

### Inbound `messages` (capture 008 vs `inbound-text.json`)

| Field | Verdict | Notes |
|---|---|---|
| `object` | confirmed | `"whatsapp_business_account"` |
| `entry[].id` | confirmed | numeric-string WABA id |
| `entry[].changes[].field` | confirmed | `"messages"` |
| `value.messaging_product` | confirmed | `"whatsapp"` |
| `value.metadata.display_phone_number` / `.phone_number_id` | confirmed | both numeric strings |
| `contacts[].profile.name` | confirmed | present on inbound messages |
| `contacts[].wa_id` | confirmed | equals `messages[].from` |
| `contacts[].user_id` | **corrected** (added) | new field, country-prefixed (`"VE.1470891188060290"`); fixtures use synthetic `CO.*` |
| `messages[].from` | confirmed | E.164 without `+` |
| `messages[].from_user_id` | **corrected** (added) | new field, mirrors contact `user_id` |
| `messages[].id` | confirmed | `wamid.…` |
| `messages[].timestamp` | confirmed | epoch-seconds string |
| `messages[].text.body` | confirmed | |
| `messages[].type` | confirmed | `"text"` |

### `statuses` — sent / delivered / read (captures 002–007 vs `status-*.json`)

| Field | Verdict | Notes |
|---|---|---|
| `value.contacts` on status deliveries | **corrected** (added) | statuses DO carry `contacts: [{ wa_id, user_id }]` — no `profile`; reconstructions omitted the array entirely |
| `statuses[].id` / `.status` / `.timestamp` / `.recipient_id` | confirmed | |
| `statuses[].recipient_user_id` | **corrected** (added) | new field |
| `statuses[].conversation.id` | **corrected** | 32-char hex string, not a `conv.*` slug |
| `statuses[].conversation.expiration_timestamp` | **corrected** | present on `sent` only; sandbox quirk: equals `timestamp` (not +24h) — do not build logic on its value |
| `statuses[].conversation.origin.type` | confirmed | `"service"` |
| `statuses[].pricing` | **corrected** | `{ billable: false, pricing_model: "PMP", category: "service", type: "free_customer_service" }`; we had invented `CBP`/`billable: true`/no `type` key |
| `read` carrying `conversation` + `pricing` | **corrected** | our `status-read.json` had omitted both; real `read` looks like `delivered` |
| `sent` fixture existence | **corrected** (added `status-sent.json`) | captured event type we had no fixture for; the only one showing `expiration_timestamp` |

### Still-unverified

| Item | Why | Standing |
|---|---|---|
| `inbound-image.json` / `inbound-audio.json` media objects | only a text message was captured | envelope aligned with captures (`user_id`/`from_user_id`, key placement); `image`/`audio` objects remain Meta-docs reconstructions |
| `status-failed.json` `errors[]` | sandbox produced no failure | status envelope aligned with captured sent/delivered/read; `errors[]` + absence of `conversation`/`pricing` unverified |
| `accepted` status value | never delivered by sandbox (it's our own optimistic initial `wa_status`) | fine — it originates from our sender, not webhooks |
| `echo-owner-reply.json`, `history-sync.json` | coexistence-only; sandbox cannot emit them | untouched reconstructions per brief. Structural implication noted: every captured contact/message carried `user_id`/`from_user_id`, so real echo/history payloads likely do too — treat those fields as optional everywhere; re-verify at coexistence onboarding (runbook, last section) |
| Production transport | sandbox is the On-Premise surface (`waba-sandbox.360dialog.io/v1`) | Phase 4 TODO below |

## Signature reality (task 4)

**360dialog does not sign sandbox deliveries.** All 6 non-probe captures carry
**no signature header of any kind** (headers are: CF tunnel headers, Sentry
traces, `user-agent: python-httpx/0.28.1`, `content-type: application/json`).
The auth probe confirmed the actual model: Basic auth embedded in the
registered URL arrives as `Authorization: Basic …`, and custom headers
configured at registration are forwarded verbatim. Security = possession of the
secret webhook URL + optional Basic auth/custom headers, enforced at the edge.

Implementation (per brief's unsigned branch):

- HMAC stub in `packages/shared/src/webhook-signature.ts` **kept** for
  `pnpm simulate` + tests; header comment now documents captured reality.
- `WEBHOOK_VERIFY=stub|360dialog|off` (default `stub`) added to
  `apps/runtime/src/env.ts`; `createApp` takes `webhookVerify` and only
  enforces the stub HMAC in `stub` mode. `360dialog` and `off` accept unsigned
  requests (behaviorally identical today; the value documents intent, and
  `360dialog` logs a loud boot warning to secure the URL at the edge).
- **TODO(Phase 4)** (logged in `env.ts`, `app.ts`, `webhook-signature.ts`,
  fixtures README): confirm production/Cloud-API deliveries — possibly
  Meta-style `X-Hub-Signature-256` — and implement real verification behind
  `signWebhookPayload`/`verifyWebhookSignature` if a scheme exists.

## Decisions (numbered)

1. **Identity-swap scope**: kept every pre-existing seed identity (wamids,
   phones, `entry[].id`) so `pipeline.test.ts` / `flow.test.ts` hardcoded ids
   keep matching; added synthetic `CO.*` `user_id`s (mirroring the captured
   country-prefixed `VE.*` format) and 32-hex `conversation.id`s. Nothing else
   about the captured structure altered — including JSON key order (`value`
   before `field`, `type` last in messages).
2. **`status-sent.json` added** as captured-verified — a captured event type
   with no fixture, and the only carrier of `conversation.expiration_timestamp`.
   Not feature work: R1's status-ordering work will need it.
3. **`parseEnvelope` needed zero logic changes** — every path it extracts
   (`metadata.phone_number_id`, `field`, `messages[].{id,from,type,text.body}`,
   `contacts[].{wa_id,profile.name}`, `statuses[].{id,status}`) exists verbatim
   in the captures, and the new fields (`user_id`/`from_user_id`/
   `recipient_user_id`, `conversation`, `pricing`) are ones the Phase 1
   pipeline deliberately ignores. The header comment now records the
   captured-verified provenance instead of "reconstructions pending capture".
4. **Envelope graduation refinement (P1-Q2)**: parser stays runtime-local;
   graduation to `packages/shared` stays deferred **until the echo
   (`smb_message_echoes`) shape is also captured-verified** — the fixture task
   has now "landed" but only partially confirms shapes, so the original
   trigger is refined rather than fired.
5. **Partially-verified fixtures get the envelope corrections**: `inbound-image`,
   `inbound-audio`, `status-failed` share the captured envelope families, so
   their common fields were aligned; only their payload objects
   (`image`/`audio`/`errors[]`) remain reconstructions. README marks the split
   per file. `echo-owner-reply` / `history-sync` untouched per brief.
6. **Sandbox pricing values copied verbatim** (`PMP` / `free_customer_service` /
   `billable: false`) — captured ground truth. Production paid conversations
   will differ; nothing in our pipeline reads `pricing`.
7. **`WEBHOOK_VERIFY` unit-tested with `FakeDb`** (`test/app.test.ts`: stub
   accepts signed / 401s unsigned; `360dialog` and `off` accept unsigned) and
   `360dialog` mode verified live with an unsigned curl POST → 200, event
   queued, tenant resolved.
8. **Phase 1 `SESSION_NOTES.md` moved** to `docs/session-notes/phase-1.md`
   (content unchanged), same convention as Phase 0, freeing this file.

## Questions for the coordinator

1. `360dialog` and `off` verify modes are behaviorally identical until Phase 4
   (both accept unsigned). Keep the three-value enum as ratified intent, or
   should `360dialog` mode additionally enforce a configured Basic-auth
   credential at the app layer in Phase 4 (rather than trusting the edge)?
2. The sandbox `expiration_timestamp == timestamp` quirk means the sandbox is
   useless for testing 24h-window math from status payloads. R1's window logic
   should derive windows from `last_customer_message_at` (as specced), not from
   `conversation.expiration_timestamp` — confirm.
3. `contacts[].user_id` / `from_user_id` look like a WhatsApp identity rollout
   (country-prefixed). We ignore them today; worth capturing as a note for the
   CRM data model (dedupe across phone-number changes) in a later phase?
