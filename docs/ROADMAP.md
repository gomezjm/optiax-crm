# Optiax CRM — Build Roadmap & Coordination Guide

Working name: **Optiax** (final name TBD — never hardcode it in UI strings; use a `BRAND` constant).

Source documents (repo root): `PRD_ LatAm WhatsApp CRM & AI Agent.md` (product scope) and `whatsapp-crm-architecture.md` (technical architecture). This roadmap governs sequencing; those two govern *what* and *how*. On conflict, this file wins on sequencing, the architecture doc wins on technical decisions, the PRD wins on product behavior.

## Decisions log

| Date | Decision |
|---|---|
| 2026-07-18 | Scope = **full PRD** (all 8 screens incl. campaigns, segments, team roles). Schema for everything lands in Phase 0; features are built across phases. |
| 2026-07-18 | Coding agents = **Claude Code** sessions. One git branch per session, PR-style review by Juan. |
| 2026-07-18 | Infra today: Gemini API key ✅, 360dialog account ✅, **no hosted Supabase project yet** → all dev is local-first (`supabase` CLI) with webhook fixtures. Hosted project created in Phase 5. |
| 2026-07-18 | UI: **Spanish-first, i18n-ready** (`es.json` from day one, `en` later). |
| 2026-07-18 | Monorepo, pnpm workspaces: `packages/shared`, `apps/runtime`, `apps/dashboard`. |
| 2026-07-19 | Phase 2 runs **sequentially** (one session at a time): R1 → D1 → D2 → R2 → R3 → D3 → D4. Each branches off `main` after the previous merge — no cross-branch conflicts to manage. |
| 2026-07-19 | Phase 1 ratifications: repo-module surface incl. `webhookEvents`/`queue`; envelope parser runtime-local until real payloads; `gemini-2.5-flash` default. See phase-1 spec §9. |
| 2026-07-21 | **Phase 2 complete.** D4 ratifications: `attribute_defs.type` immutable; `Ventas de hoy` naive sum valid under one-currency-per-tenant; self-service `display_name` → Phase 4; last fixed-`-05:00` spot in orders `query-translation.ts` → Phase 4 tz pass. **Corrected PRD screen map** (session mis-numbered): live = 0,1,4,5,6,7; deferred = Segments (2) + Campaigns (3). See D4 spec §6. |
| 2026-07-21 | D3 ratifications: interactive Publish uses real Gemini (CI-only "never gates" rule unchanged); deterministic assertions are the hard block, judge advisory; `business.vertical` is a select bound to verticals with eval suites; reps get read-only config + Playground; save-gated-on-valid + in-app nav guard deferred (backlog / D4). Runtime↔dashboard contract in `@optiax/shared` `runtime-api.ts`; publish is an atomic `security-definer` RPC. See D3 spec §9. |
| 2026-07-20 | R3 ratifications: in-memory eval gate is canonical (DB path covered by isolation suite); `evaluateDraft` + LLM-judge are the publish contract D3 wires; `eval:live` informational-only, nightly alerting → Phase 5. **R2 Q-C and Q-D closed with live-probe data — both dropped, not built** (catalog recall fine at 1–2/5 re-checks; payment-proof escalation 5/5). See R3 spec §6. |
| 2026-07-20 | R2 ratifications: tool-result recall + payment-proof escalation routed to R3 (eval-driven, not built blind); 4-round-ceiling handoff must set `needs_attention` (defect → R3 mandatory fix); `capture_lead`→`capture_customer` confirmed + arch doc corrected; `COMPILER_VERSION` 1.1.0 → published prompts recompile on reseed / owed op for hosted tenants. See R2 spec §8. **Process note**: R2 session merged D2 to main without Juan's review gate — acceptable this once (D2 green+ratified), but reinforce that agents branch off main and never self-merge. |
| 2026-07-20 | D2 ratifications: `total_spent` counts all non-cancelled orders (rule kept, column relabelled "Total en pedidos"); unrestricted status transitions confirmed; `verified_by`/`sort_order`/editable-items approved as future additive changes; dashboard timezone hardcoding is a Phase-4-prep fix. See D2 spec §7. |
| 2026-07-19 | D1 ratifications: **English route paths** (`/orders`, `/products`, …) with Spanish labels; **phones stored as bare digits everywhere**; shadcn extras (`shadcn` pkg, `sonner`, `tw-animate-css`) in-scope of the pre-approval; **no externally-hosted fonts, ever**; `packages/shared` subpath-export split approved → R2. See D1 spec §10. |
| 2026-07-19 | Fixture-session ratifications: (1) **360dialog does not sign deliveries** — `WEBHOOK_VERIFY=stub\|360dialog\|off` enum stands; in Phase 4, `360dialog` mode gains app-layer credential enforcement (secret URL token / Basic-auth header) — never trust the edge alone. (2) 24h window derives from `last_customer_message_at`, never webhook `expiration_timestamp`. (3) `contacts[].user_id`/`from_user_id` (country-prefixed WhatsApp identity) ignored for now; candidate `customers.wa_user_id` column later for identity continuity across number changes — additive migration when justified. |

## Repo layout (target)

```
/docs
  ROADMAP.md                  ← this file
  /specs                      ← one spec per phase/workstream (written by coordinator, consumed by agents)
  /prompts                    ← paste-ready session briefs
/packages/shared              ← Zod schemas, generated Supabase types, prompt compiler, fixtures
/apps/runtime                 ← webhook receiver, pgmq worker, agent loop (Hono, Railway)
/apps/dashboard               ← Next.js App Router + Tailwind + shadcn/ui
/supabase                     ← migrations, seed, RLS tests
CLAUDE.md                     ← root conventions (per-package CLAUDE.md too)
```

## Phases

### Phase 0 — Contracts (1 session, serial, **Juan reviews line by line**)
Everything downstream depends on this. Spec: `docs/specs/phase-0-contracts.md`. Brief: `docs/prompts/phase-0-session-brief.md`.

Deliverables: monorepo scaffold · full Supabase migrations + RLS · **multi-tenant isolation test suite** · `agent_config` Zod schema · prompt compiler + snapshot tests · 360dialog webhook fixtures + simulate script · seed data (2 tenants) · CLAUDE.md files · CI (typecheck + tests + db tests).

### Phase 1 — Walking skeleton (1 session, serial)
One thin end-to-end slice: fixture webhook POSTed to local runtime → signature check → pgmq enqueue → worker resolves tenant → real Gemini call (Flash, key from env) → reply persisted (send step mocked) → visible in a bare inbox page via Supabase Realtime. De-risks every integration at once; becomes the working reference for all later sessions. Spec written after Phase 0 review.

### Phase 2 — Parallel workstreams (independent sessions, independent branches)

| ID | Workstream | Depends on |
|---|---|---|
| R1 | Runtime: coexistence pause (`smb_message_echoes` → `bot_paused`), 24h-window gating, operating hours, master toggle, dedupe/retry hardening | Phase 1 |
| R2 | Runtime: agent tools — `capture_customer`, `create_order`, `check_catalog`, `handoff_to_human`; audio policy (STT or canned reply) | Phase 1 |
| R3 | Evals: per-vertical canned conversations, LLM-judge, publish gate | Phase 1 |
| D1 | Dashboard: Customers screen (directory, tags, attribute master, filters, mass edit, CSV import) | Phase 1 |
| D2 | Dashboard: Orders + Products screens (status pipeline, payment proof flag, export; catalog CRUD) | Phase 1 |
| D3 | Dashboard: Agent configurator wizard + Playground (draft mode against runtime) + publish flow | Phase 1, R3 for publish gate |
| D4 | Dashboard: Home KPIs + Settings masters (order statuses, payment methods, attributes) | D1, D2 schemas exercised |

### Phase 3 — Campaigns & segments
C1: segment rule engine + Segments screen. C2: WhatsApp template manager (Meta submission via 360dialog), campaign broadcasts + ROI metrics, auto-replies. Depends on D1 + R1 (send path, 24h/template rules).

### Phase 4 — Onboarding & ops
360dialog Embedded Signup (coexistence QR), contact/history import webhooks, n8n cold paths (onboarding, keep-alive alerts, digests), team roles UI. Also owed from earlier ratifications: confirm production webhook transport; app-layer credential enforcement for `WEBHOOK_VERIFY=360dialog` (secret URL token / Basic-auth header); capture real `smb_message_echoes` + history-sync payloads from a coexistence number and graduate `envelope.ts` types to `packages/shared`.

### Phase 5 — Hardening & launch
Hosted Supabase project + deploy (Vercel, Railway), env/secrets, billing, GDPR deletion endpoint, observability dashboards, load test on webhook path.

## Session protocol (how Juan runs each session)

1. Coordinator (this chat) produces `docs/specs/<id>.md` + `docs/prompts/<id>-session-brief.md`.
2. Juan opens Claude Code in the repo, pastes the brief. Agent works on branch `feat/<id>`.
3. Every brief includes the same invariants: read `docs/specs/phase-0-contracts.md` first; **never** edit migrations retroactively (new migration files only); **isolation tests must stay green**; types come from `packages/shared` — never redeclared locally; UI strings go in `es.json`; **branch off `main` and never self-merge to `main`** — Juan owns the merge gate (if a prerequisite branch isn't on `main` yet, stop and tell Juan rather than merging it yourself).
4. Session ends with a `SESSION_NOTES.md` on the branch: what was done, what was skipped, questions for coordinator. Juan pastes notes back here; coordinator updates this roadmap's status board and produces the next brief.
5. Juan reviews the diff (Phase 0 fully; later phases: schema changes, RLS, and anything touching `packages/shared` always get eyes).

## Status board

| Phase/WS | Status | Branch | Notes |
|---|---|---|---|
| Phase 0 | **merged** | `feat/phase-0-contracts` | 31 decisions ratified → spec §11. |
| Phase 1 | **merged** | `feat/phase-1-walking-skeleton` | 24 decisions + 5 answers → spec §9. |
| Fixture correction | **merged** | `feat/fixture-capture-correction` | Envelope capture-verified; `WEBHOOK_VERIFY` enum. |
| R1 | **merged** | `feat/ws-r1-coexistence` | 20+5 ratified → R1 spec §8. Echo guesses E1–E5 await Phase 4 capture. |
| D1 | **merged** | `feat/ws-d1-customers` | 20+5 ratified → D1 spec §10. App shell + shadcn foundation. |
| D2 | **merged** | `feat/ws-d2-orders-products` | 31+7 ratified → D2 spec §7. `total_spent` trigger. |
| R2 | **merged** | `feat/ws-r2-agent-tools` | 5 answers → R2 spec §8. Tool loop + 4 executors. `COMPILER_VERSION` 1.1.0. |
| R3 | **merged** | `feat/ws-r3-evals` | 5 answers → R3 spec §6. R2 Q-C/Q-D closed with data. `evaluateDraft` gate. |
| D3 | **built + verified live** (353 unit, 288 db tests, prod build ✓) — pending Juan's review + merge | `feat/ws-d3-configurator` | 5 answers ratified → D3 spec §9. Runtime `/playground` + `/publish` (JWT-scoped); configurator + playground + publish flow. Migration 10 (`publish_agent_config` RPC). |
| D4 | **built + verified live** (378 unit, db:test green incl. new settings/home DB tests, prod build ✓) — pending Juan's review + merge | `feat/ws-d4-home-settings` | 4 answers ratified → D4 spec §6. Migrations: `orders.verified_by` + nav guard. **Phase 2 COMPLETE** — 6/8 PRD screens live. |
| **Phase 2** | ✅ **complete** (pending D4 merge) | — | Live: Screens 0,1,4,5,6,7. Core product demoable end-to-end: configure → playground → publish → WhatsApp msg → captured order/customer. |
| C1 (Segments, Screen 2) | not started — Phase 3 | — | `SegmentRulesSchema` already exists (phase-0). Mostly rule-builder UI + evaluation + segment view. |
| C2 (Campaigns, Screen 3) | not started — Phase 3 | — | Template manager (Meta/360dialog submission), broadcasts + ROI, auto-replies. Depends on C1 + the send path. |

## Juan's action items (not agent work)

- **Now (before merging Phase 0):** create the GitHub repo, add remote, push `feat/phase-0-contracts`, and confirm the CI workflow actually passes once — a committed-but-never-run `ci.yml` is unverified. Also confirm the committed `SESSION_NOTES.md` is the final 31-decision version.
- Before Phase 1: put Gemini key in `apps/runtime/.env.local` (never committed).
- Now: run the sandbox capture (runbook: `docs/runbooks/capture-360dialog-webhook.md`) — inbound + status payloads, then hand to the fixture-correction session. **Echo/history-sync capture is deferred to Phase 4**: the sandbox can't produce coexistence events; they need a real coexistence-connected number (Embedded Signup). Until then the echo shape stays a reconstruction isolated in `envelope.ts`.
- Before Phase 4: 360dialog partner webhook URL config; test Embedded Signup flow manually once.
- Before Phase 5: create hosted Supabase project; Vercel + Railway accounts; pick the final product name.

## Known risks

- **RLS drift** — the top agentic-coding failure mode here. Mitigation: Phase 0 meta-test that fails if any `public` table lacks RLS or `tenant_id`; every brief requires the suite green.
- **Fixture inaccuracy** — 360dialog payloads reconstructed from Meta Cloud API docs may differ in envelope details. Mitigation: capture real payloads early (action item above); keep the webhook parser in one module.
- **Full-PRD schema up front** — broad surface reviewed once. Mitigation: Phase 0 review is line-by-line; later changes are additive migrations only.
