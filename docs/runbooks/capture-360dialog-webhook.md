# Runbook: capture a real 360dialog webhook payload (sandbox)

Operational task, run by the coordinator (needs a phone + the live sandbox). Goal:
capture the **real HTTP transport** 360dialog uses — exact headers, auth scheme,
and envelope wrapper — from real deliveries, and use it to correct the
reconstructed contracts.

## What this gets you — and what it can't

- **Yes:** the real headers + auth 360dialog attaches, and the real envelope
  wrapper, from live `messages` (inbound) and `statuses` deliveries. This is what
  corrects the HMAC stub in `packages/shared/src/webhook-signature.ts` and
  confirms/adjusts the fixture envelope.
- **No: a real owner-reply echo (`smb_message_echoes`).** That is a
  **Coexistence-only** event — it fires when a human replies from the WhatsApp
  Business *app* on a number that is also on the Cloud API. The sandbox is a
  shared test number with no Business app behind it, so it cannot emit one. The
  `echo-owner-reply.json` body stays a documented reconstruction until a
  coexistence capture (last section). Its shape already matches Meta's official
  `smb_message_echoes` reference, so this is expected, not a gap.

## Prereqs

- `pnpm i` done, Node 20+.
- A WhatsApp phone.
- A tunnel: **cloudflared** (recommended, no account: `brew install cloudflared`)
  or ngrok (`brew install ngrok`, needs a free account now).
- Your sandbox `D360-API-KEY` (from the 360dialog sandbox console).

## Steps

### 1. Start the capture server

```bash
pnpm capture            # listens on http://localhost:8788
```

Writes one JSON file per delivery to `captures/360dialog/` (gitignored) and
prints the event field + interesting headers to the console as they land.

### 2. Expose it

```bash
cloudflared tunnel --url http://localhost:8788
# → copy the https://<random>.trycloudflare.com URL it prints
# ngrok alternative:  ngrok http 8788
```

### 3. Point the sandbox at your tunnel

```bash
curl --request POST \
  --url https://waba-sandbox.360dialog.io/v1/configs/webhook \
  --header 'Content-Type: application/json' \
  --header 'D360-API-KEY: <YOUR_SANDBOX_D360_API_KEY>' \
  --data '{"url": "https://<random>.trycloudflare.com/webhooks/wa"}'
```

The `/webhooks/wa` path deliberately mirrors the real runtime route, so you can
later point the same tunnel at `pnpm --filter @optiax/runtime dev` (:8787)
without changing the registration.

**Probe the auth question:** to see how 360dialog presents credentials (the whole
point of the signature-stub fix), also try registering with Basic auth in the URL
and compare what arrives:

```bash
--data '{"url": "https://user:pass@<random>.trycloudflare.com/webhooks/wa"}'
```

If the delivery then carries `Authorization: Basic ...` and no signature header,
that confirms 360dialog authenticates by secret-URL/Basic auth, not a Meta-style
HMAC — which is the correction the stub needs.

### 4. Trigger the events the sandbox can emit

- **Inbound `messages`:** from your phone, send any WhatsApp message to the
  sandbox number **+49 30 577140849** (use whatever number your sandbox console
  shows). It is forwarded to your webhook.
- **Outbound `statuses`:** send a message via the API to your own phone (do the
  inbound step first so you're inside the 24h window):

```bash
curl --request POST \
  --url https://waba-sandbox.360dialog.io/v1/messages \
  --header 'Content-Type: application/json' \
  --header 'D360-API-KEY: <YOUR_SANDBOX_D360_API_KEY>' \
  --data '{"messaging_product":"whatsapp","to":"<YOUR_PHONE_E164>","type":"text","text":{"body":"capture test"}}'
```

You should see `sent` → `delivered` → `read` status deliveries land.

### 5. Collect + hand back

Each delivery is one file in `captures/360dialog/`. Send back (or point the
coordinator at) **one inbound file and one status file**. Next steps on my side:

- confirm/correct the real envelope wrapper against the reconstructed fixtures,
- replace the HMAC `x-webhook-signature` stub in
  `packages/shared/src/webhook-signature.ts` with 360dialog's actual scheme (or
  record "unsigned — rely on secret URL / Basic auth"),
- add the `SESSION_NOTES.md` lines the R1 spec (§2, DoD) asks for.

## Caveats

- The sandbox is the **On-Premise** API surface (`waba-sandbox.360dialog.io/v1`).
  Production Cloud-API / coexistence transport (Meta-shaped, possibly
  `X-Hub-Signature-256`) can differ — treat sandbox findings as "corrects the
  stub toward reality," and re-verify at real onboarding.
- Never commit `captures/` (gitignored) — payloads contain phone numbers. The
  sandbox API key is throwaway; rotate it anytime.

## Later: capturing a REAL echo (coexistence)

When a real number is onboarded via 360dialog embedded signup with WhatsApp
Coexistence: keep this same server + tunnel, register `<tunnel>/webhooks/wa` on
that WABA (the Meta `GET` verify handshake is handled — start with
`VERIFY_TOKEN=<token> pnpm capture` and use the same token in signup), then from
the WhatsApp Business app on that phone reply to a customer chat. The
`smb_message_echoes` delivery lands in `captures/360dialog/` — that is the
one-file correction `envelope.ts` and the fixture were designed to accept.
