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
360dialog Embedded Signup (coexistence QR), contact/history import webhooks, n8n cold paths (onboarding, keep-alive alerts, digests), team roles UI.

### Phase 5 — Hardening & launch
Hosted Supabase project + deploy (Vercel, Railway), env/secrets, billing, GDPR deletion endpoint, observability dashboards, load test on webhook path.

## Session protocol (how Juan runs each session)

1. Coordinator (this chat) produces `docs/specs/<id>.md` + `docs/prompts/<id>-session-brief.md`.
2. Juan opens Claude Code in the repo, pastes the brief. Agent works on branch `feat/<id>`.
3. Every brief includes the same invariants: read `docs/specs/phase-0-contracts.md` first; **never** edit migrations retroactively (new migration files only); **isolation tests must stay green**; types come from `packages/shared` — never redeclared locally; UI strings go in `es.json`.
4. Session ends with a `SESSION_NOTES.md` on the branch: what was done, what was skipped, questions for coordinator. Juan pastes notes back here; coordinator updates this roadmap's status board and produces the next brief.
5. Juan reviews the diff (Phase 0 fully; later phases: schema changes, RLS, and anything touching `packages/shared` always get eyes).

## Status board

| Phase/WS | Status | Branch | Notes |
|---|---|---|---|
| Phase 0 | not started | — | brief ready |
| Phase 1 | blocked by P0 | — | |
| R1–R3, D1–D4 | blocked by P1 | — | |
| C1–C2 | blocked by Phase 2 | — | |

## Juan's action items (not agent work)

- Before Phase 1: put Gemini key in `apps/runtime/.env.local` (never committed).
- During Phase 1–2: capture **real** webhook payloads from the 360dialog sandbox and replace/confirm fixtures in `packages/shared/fixtures/` (fixtures are best-effort reconstructions until then).
- Before Phase 4: 360dialog partner webhook URL config; test Embedded Signup flow manually once.
- Before Phase 5: create hosted Supabase project; Vercel + Railway accounts; pick the final product name.

## Known risks

- **RLS drift** — the top agentic-coding failure mode here. Mitigation: Phase 0 meta-test that fails if any `public` table lacks RLS or `tenant_id`; every brief requires the suite green.
- **Fixture inaccuracy** — 360dialog payloads reconstructed from Meta Cloud API docs may differ in envelope details. Mitigation: capture real payloads early (action item above); keep the webhook parser in one module.
- **Full-PRD schema up front** — broad surface reviewed once. Mitigation: Phase 0 review is line-by-line; later changes are additive migrations only.
