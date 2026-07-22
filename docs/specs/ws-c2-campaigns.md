# Workstream C2 — Campaigns: Template manager + Broadcasts + ROI

PRD Screen 3's outbound core. Spans dashboard + runtime: manage Meta message templates, send targeted broadcasts to C1 segments, track ROI. The last big feature session; it lights up the final PRD screen (minus auto-replies, which are C3).

**Sending is mocked** — there is no real WhatsApp channel until Phase 4 (Embedded Signup). Build the full shape against `MockWaSender` and mocked Meta approval, exactly as R2 mocked replies. When the real channel lands, only the sender + the 360dialog submission call swap in.

Read first: PRD Screen 3; architecture doc §5 (24h window + templates) and the n8n cold-path note; **C1's shared `segmentRulesToQuery` engine** (broadcasts resolve recipients through it, server-side); R1's `assertWithinWindow` + status-rank guard (broadcasts obey the window and reuse status handling); R2's tool loop only insofar as orders carry `campaign_id`; ratified decisions phase-0 §11 … **C1 §7**. Schema: `wa_templates`, `campaigns`, `messages.campaign_id`, `orders.campaign_id` all exist (phase-0); `campaigns` has `sent_count`/`read_count`.

**Not in scope**: auto-replies (C3); real WhatsApp sending / real 360dialog partner API (Phase 4); n8n wiring (Phase 4 — the broadcast executor lives in the runtime for now, testably); segment CRUD (C1 owns it — C2 reads segments).

## 0. Carry-ins (ratified — each its own commit, first)

1. **Unify the D1 customers date filter to calendar-day** (C1-1): the customers-screen `older_/newer_than_days` filter should use the same tenant-local-calendar-day bounds as the C1 engine (share the helper). One phrase, one meaning across the customers screen and segments. Regression-test the boundary.
2. **Enforce the segment delete-guard** (C1-4): a segment referenced by a non-terminal campaign (`draft`/`scheduled`/`running`) cannot be deleted — DB FK is `on delete restrict` already (verify) + a friendly dashboard error. Add the guard the C1 stub anticipated.

## 1. Template manager (`/campaigns` → Plantillas tab) — `wa_templates`

The Meta-approved-template lifecycle, mocked where it would hit Meta:

- CRUD over `wa_templates`: name, language (default `es`), category, body with `{{1}}`-style variables, `variables` list (labels for each placeholder so the campaign builder can prompt for values). Validate variable count matches the body.
- Approval lifecycle `meta_status`: `draft → submitted → approved | rejected`. "Enviar a aprobación" transitions `draft → submitted`; since there's no real partner API, a **mock approver** (a dev-only action or a short timer/manual toggle behind an env flag) moves `submitted → approved` and stamps a fake `meta_template_id`. Make the mock boundary a single, clearly-named module (`submitTemplateForApproval`) so Phase 4 swaps in the real 360dialog call. Document the mock in `SESSION_NOTES.md`.
- Only `approved` templates are selectable in a campaign (the 24h-window rule: outside the window you may send *only* approved templates — this is why campaigns to cold segments require them).
- Admin-only writes (templates configure outbound comms → treat like config; verify against the seeded rep). Reps read.

## 2. Broadcast campaigns (`/campaigns` → Campañas tab) — `campaigns`

- Builder: name, pick a **segment** (C1) → **live recipient count via the shared engine**, pick an **approved template** → prompt for variable values (static, or simple per-customer field mappings like `{{1}} = name` — keep it to static + a small set of customer fields; document what's supported), schedule `starts_at` (and optional `ends_at`). Save as `draft`.
- Lifecycle `status`: `draft → scheduled → running → done | cancelled`. "Programar" → `scheduled`. Cancel from `draft`/`scheduled`/`running`.
- **Broadcast executor** (runtime — the one runtime addition): a triggerable job (`POST /campaigns/:id/run` authed like D3's endpoints, or a scheduled tick — pick the simpler; a manual trigger is fine for MVP and testable) that: loads the campaign, re-resolves the segment **at send time** through the shared engine (audiences are live), and for each recipient — checks `assertWithinWindow`; **inside** window may send free-form or template; **outside** window sends the approved template only; sends via `MockWaSender`; writes a `messages` row (`direction: 'outbound'`, `source: 'campaign'`, `campaign_id`, `template_name`); increments `sent_count`. Idempotent per (campaign, customer) — a re-run never double-sends (dedupe on an existing campaign message to that customer). Respects `bot_paused`? No — a broadcast is owner-initiated outbound, independent of the per-conversation bot pause; document this explicitly. On completion → `done`.
- Everything through the **tenant-scoped repo** (service-role never leaves `src/db/`); recipient resolution reuses C1's engine bound to the tenant.
- Rate/throughput: keep it simple (sequential or small batches) — real pacing/Meta rate limits are a Phase 4/5 concern; note it.

## 3. ROI metrics (PRD)

Per campaign: **Enviados** (`sent_count`), **Leídos** (`read_count` — from status webhooks: a `read` status on a message with a `campaign_id` increments it; reuse R1's status-rank guard so counts don't double), **Pedidos generados** and **Ingresos generados** (orders whose `campaign_id` = this campaign, count + sum of `total` excluding cancelled — reuse the D2 `total_spent` rule). Attribution: an order created within a conversation that a campaign message touched gets that `campaign_id` — wire the minimal version (order created after a campaign message in the same conversation inherits the most-recent `campaign_id`; document the heuristic and its limits). A campaign list view with these four columns + a detail view.

## 4. Status & attribution plumbing

- Extend the existing status handler (R1): a `read`/`delivered` status on a `campaign_id` message updates the message and, for `read`, the campaign's `read_count` (rank-guarded, idempotent).
- `messages.source = 'campaign'` and `campaign_id` set on every broadcast message (already in the enum/schema from phase-0).
- Order attribution as §3; keep the rule in one place so it's auditable.

## 5. Roles & data

- Campaigns are **rep-readable, admin-write** (they spend goodwill/quota and go to customers — treat as config-adjacent; confirm the intended matrix and enforce, noting phase-0 lists campaigns as rep-read). Templates admin-write (§1). Verify both against the seeded rep.
- Dashboard uses anon key + RLS; the broadcast executor + status writes go through the runtime (service-scoped) since they write across customers. Draft/schedule edits are direct RLS writes.

## 6. Tests

- Carry-ins: D1 date-filter calendar-day boundary; segment delete-guard (blocked when a live campaign references it).
- Template lifecycle: draft→submitted→approved (mock), variable-count validation, only-approved selectable.
- Broadcast executor (integration, real Postgres, MockWaSender + FakeModel): resolves a segment to the right recipients, sends one message each, `sent_count` correct, **re-run doesn't double-send**, outside-window path uses a template and inside-window path is allowed, tenant isolation (never messages another tenant's customers).
- ROI: `read` status on a campaign message bumps `read_count` once (rank-guarded); order with `campaign_id` shows in Pedidos/Ingresos; cancelled excluded.
- Isolation + meta + eval suites green; `pnpm typecheck && pnpm lint && pnpm test && pnpm db:test` + prod build green. No schema change expected (all columns exist); if one is needed, additive migration + tenant_id + RLS + grants.

## 7. Definition of done

- [ ] Carry-ins 0.1–0.2 landed, each its own commit
- [ ] Demo (script in `SESSION_NOTES.md`): create a template → send for approval → (mock) approved; build a campaign targeting a C1 segment → see live recipient count → schedule → run the executor → `messages` rows appear (`source=campaign`, mock-sent), `sent_count` matches; re-run → no double-send; simulate a `read` status on a campaign message → `read_count` +1; an order tagged with the campaign shows in ROI; a rep sees campaigns read-only
- [ ] Broadcast recipients resolved through C1's shared engine, server-side, tenant-scoped; mock send/approval isolated behind single named seams for Phase 4 swap
- [ ] Window rules honored (outside 24h → approved template only); status counts rank-guarded and idempotent
- [ ] Every UI string in `es.json`; no service key in the dashboard; admin/rep gating verified
- [ ] `SESSION_NOTES.md`: numbered assumptions, demo script, questions — and note what remains for Phase 3 (C3 auto-replies) and Phase 4 (real send/approval, n8n, pacing)
