# Session brief: Workstream R2 — Agent tools (function calling)

*(Run only after `feat/ws-d2-orders-products` is merged to `main`. Paste everything below into Claude Code at the repo root.)*

---

You are building **workstream R2**, the core of the Optiax WhatsApp CRM: the agent's function-calling tools — `check_catalog`, `capture_customer`, `create_order`, `handoff_to_human` — so it can act, not just chat. Runtime session extending the Phase 1 loop and R1's guards. Tool arguments and DB writes reuse the exact Zod schemas D2 placed in `packages/shared`.

## Read first, in this order
1. `docs/specs/ws-r2-agent-tools.md` — your spec. §0 carry-overs come first, each its own commit, before any tool work.
2. Ratified decisions: phase-0 §11, phase-1 §9, R1 §8, **D2 §7**. Do not "fix" any of them.
3. `apps/runtime/src/model/`, the worker pipeline, R1's `window.ts`/pause/skip logic, and the compiler (`packages/shared/src/compiler/`).

## Setup
- Branch `feat/ws-r2-agent-tools` off `main`.
- `supabase start && supabase db reset && pnpm seed:auth` (Kong quirk → `docker restart supabase_kong_optiax-crm`).
- Real `GEMINI_API_KEY` in `apps/runtime/.env.local` for the manual demo; automated tests use `FakeModel` with scripted tool calls — never the network.

## Deliverables (detailed in the spec)
1. Carry-overs 0.1–0.4: `no_published_config` skip reason; `outside_hours` requires `schedule`; `@optiax/shared/webhook` subpath split (drop the browser stub); `order_items.sort_order` migration.
2. `AgentModel` tool support + `FakeModel` scriptable tool calls + `GeminiModel` function-calling mapping (§1).
3. Config-driven tool declarations; bounded 4-round tool loop, all execution through the tenant repo (§2).
4. The four executors, each validating with a shared Zod schema, each returning structured results (§3).
5. Compiler tool-usage instructions confirmed/strengthened — **bump `COMPILER_VERSION` if the prompt changes**, update snapshots (§4).
6. Media/edge handling (§5); tests incl. adversarial injection + forged-tenant-arg scoping (§6).

## Hard rules
- The service client never leaves `src/db/`; tools act only through the tenant repo; a tool's `tenantId` comes from loop context, never from model args.
- Any compiler template change **requires** a `COMPILER_VERSION` bump (project rule) + updated snapshot tests.
- New schemas (`CaptureCustomerSchema`) in `packages/shared`; reuse `OrderCreateSchema`/`ProductSchema` verbatim — do not fork them. No `any`.
- Migrations append-only; 0.4 adds a column (no new table) — isolation + meta suites stay green. If you somehow add a table: `tenant_id` + RLS + grants.
- New deps: only a lightweight `zod-to-json-schema` if you choose that path (else hand-map) — log the choice. Nothing else.
- Scope: no audio transcription, no OCR, no campaigns/templates, no dashboard changes, no evals (R3).
- Ratified decision seems wrong → log in `SESSION_NOTES.md`, don't change it.

## Definition of done
Spec §7 checklist, all boxes. The demo must show a real Gemini agent quoting a live catalog price, capturing a customer, and creating a confirmed order that appears in `/orders` with the customer's total updated. End with `SESSION_NOTES.md`: numbered assumptions, demo script, questions.
