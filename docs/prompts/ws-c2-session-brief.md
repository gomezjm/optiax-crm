# Session brief: Workstream C2 — Campaigns (templates + broadcasts + ROI)

*(Run only after `feat/ws-c1-segments` is merged to `main`. Paste everything below into Claude Code at the repo root.)*

---

You are building **workstream C2** of the Optiax WhatsApp CRM: PRD Screen 3's outbound core — a Meta template manager, targeted broadcasts to C1 segments, and ROI metrics. Spans dashboard + runtime. **Sending and Meta approval are mocked** (no real channel until Phase 4) — build the full shape against `MockWaSender` and a mock approver, isolated behind single named seams so Phase 4 swaps them in.

## Read first, in this order
1. `docs/specs/ws-c2-campaigns.md` — your spec. §0 carry-ins first.
2. **C1's shared `segmentRulesToQuery` engine** (`packages/shared/src/segments/`) — broadcasts resolve recipients through it, server-side. R1's `assertWithinWindow` + status-rank guard (reused).
3. Ratified decisions phase-0 §11, phase-1 §9, R1 §8, D2 §7, R2 §8, R3 §6, D3 §9, D4 §6, **C1 §7**. Do not "fix" any.

## Setup
- Branch `feat/ws-c2-campaigns` off `main`. **Do not self-merge to `main`** — Juan owns the merge; if `main` lacks a prerequisite, stop and say so.
- `supabase start && supabase db reset && pnpm seed:auth` (Kong quirk → `docker restart supabase_kong_optiax-crm`).
- Real `GEMINI_API_KEY` only if a path needs it; the broadcast path uses `MockWaSender` + `FakeModel` in tests.

## Deliverables (detailed in the spec)
1. §0 carry-ins: unify D1 customers date filter to calendar-day (share C1's helper); enforce segment delete-guard against live campaigns.
2. Template manager: `wa_templates` CRUD + mock approval lifecycle behind `submitTemplateForApproval`; only approved selectable (§1).
3. Broadcast campaigns: builder (segment → live recipient count via the engine, approved template + variables, schedule); runtime broadcast executor (re-resolve segment at send time, window-aware, MockWaSender, idempotent per recipient) (§2).
4. ROI: Enviados / Leídos / Pedidos generados / Ingresos generados; status + order attribution plumbing (§3, §4).
5. Tests per §6; demo + `SESSION_NOTES.md` per §7.

## Hard rules
- Recipients resolve through C1's shared engine, **server-side, tenant-scoped**; the service client never leaves `src/db/`; the executor uses the tenant repo.
- Mock send + mock Meta approval each live behind **one named seam** for the Phase 4 real swap; document both. Never attempt a real 360dialog/Meta call.
- Broadcasts obey the 24h window (`assertWithinWindow`): outside → approved template only. Status counts reuse R1's rank guard and are idempotent; re-running a campaign never double-sends.
- Types/schemas from `packages/shared`; reuse the segment engine + existing enums verbatim; no `any`; every UI string in `es.json`; no new deps.
- No schema change expected (all columns exist); if truly needed, additive migration + `tenant_id` + RLS + grants, isolation/meta green.
- Admin/rep gating per the matrix (confirm campaigns/templates write-roles, note phase-0 has campaigns as rep-read). Ratified decision seems wrong → log it, don't change it.

## Definition of done
Spec §7 checklist, all boxes. The demo must show a segment-targeted broadcast running through the executor (mock-sent, no double-send on re-run) and ROI reflecting a read status + an attributed order. End with `SESSION_NOTES.md`: numbered assumptions, demo script, questions, and what's left for C3 + Phase 4.
