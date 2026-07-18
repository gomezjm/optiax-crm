# Phase 0 — Session notes

Assumptions and smallest-reasonable choices made where the spec was ambiguous, plus
anything intentionally not done. Spec: `docs/specs/phase-0-contracts.md`.

## Schema / RLS decisions

1. **`profiles` is enabled but NOT forced RLS** (spec §3 says "forced where sensible").
   `private.tenant_id()` is a security-definer function that reads `profiles`; forcing RLS
   there would subject the definer (owner) to the very policies being evaluated →
   recursion. Owner-bypass on unforced RLS is the standard Supabase pattern. Every other
   public table is FORCEd.
2. **`sales_rep` write matrix**: the spec's restricted list is `agent_configs`,
   `prompt_versions`, `order_statuses`, `payment_methods`, `attribute_defs`,
   `wa_templates`, `tenants`, `profiles`, plus "campaigns read-only for reps".
   `auto_reply_rules` appears in neither list; I treated it as **config → admin-only
   writes** (it configures automated agent behavior, PRD Screen 3). `products`,
   `product_categories`, `order_items`, `segments` are rep-writable (operational).
3. **`agent_turns` and `webhook_events` are runtime-only**: SELECT in-tenant for clients,
   no client write policies at all (rows come from the service role). The spec's write
   matrix doesn't mention them; least privilege chosen.
4. **`profiles` updates are admin-only wholesale** — spec says "only admin updates roles";
   there's no column-level RLS in Postgres, and splitting `display_name` self-service
   would need a second policy + column grant dance. Smallest choice: admin updates any
   in-tenant profile; self-service display_name can be added later.
5. **`prompt_versions` immutability**: UPDATE/DELETE revoked from `anon` and
   `authenticated` (plus no policies). `service_role` keeps its grants (it bypasses RLS
   by design and Phase 1's repository-module convention governs it); revoking there too
   would make GDPR-style cleanup impossible without superuser.
6. **Campaign FK cycle** resolved by ordering (spec §2 offered a choice): campaign tables
   live in migration 3, which then `alter table … add constraint` for
   `messages.campaign_id` / `orders.campaign_id`. No deferrable constraints needed.
7. **`tenants` INSERT/DELETE**: no client policies (spec: "no INSERT/DELETE from client").
   Tenant provisioning happens via service role (onboarding, Phase 1+).
8. **`anon` zero access** is enforced twice: privileges revoked (incl. `usage` on schema
   `public`) AND no anon policies exist. Future tables are covered by RLS + the meta-test.
9. Boilerplate columns: `created_at`/text columns declared `not null` where the spec
   implied presence (e.g. `tags.name`); genuinely optional per spec stayed nullable
   (all `customers` identity fields, `messages.body`, etc.).
10. `customers.source` and `orders.source` have **no default** — writers must state
    provenance explicitly.

## Shared package decisions

11. **`business.socialLinks`** (spec shows just `socialLinks?`) = `string[]` of URLs,
    max 10, each ≤ 200 chars.
12. **Free-text caps** chosen where the spec only gave the FAQ example (500):
    description 1000, handoff message 500, FAQ q 300, guardrail custom rule 300,
    forbidden topic 100, keyword 60. All in `AgentConfigSchema`, easy to revisit.
13. **`capture.fields[].key` ↔ `attribute_defs`** referential check is app-layer
    (documented in the schema file), not in Zod — Zod can't see the DB.
14. **Conditional requirements** enforced by `superRefine`: `schedule` required when
    `operatingMode = 'schedule'`; `keywords` required when a trigger kind is `'keyword'`
    (both in agent config escalation and `AutoReplyTriggerSchema`).
15. **`e_status_kind` unique per tenant** `(tenant_id, kind)` per spec — this means a
    tenant can't have two statuses of the same kind; seeded pipeline uses all 7 kinds.

## Compiler decisions

16. **Skeleton language is English** (model-facing) with a hard "reply exclusively in
    Spanish" rule — config `language` is `'es'`-only in v1.
17. **Sanitization = strip `<` and `>`** from tenant text (spec offered escape/strip).
    Stripping means tenant text can never open/close a data block; test-asserted.
18. **Two extra data blocks** beyond the spec's five: `<escalation_data>` and
    `<guardrails_data>`. The spec requires escalation/guardrails in the behavior section
    AND all tenant-authored text inside data blocks — these blocks reconcile that by
    living inside the behavior section. The standing "data ≠ instructions" rule names all
    seven blocks.
19. **Identity section contains no tenant text** — display name/business name are
    referenced via `<business_data>` ("speak as the assistant defined there").
20. `resolveVertical` falls back to `generic` for unknown verticals (seed tenant B's
    `food` vertical intentionally exercises this).

## Seed / fixtures decisions

21. **`scripts/seed-auth.ts` does more than auth**: auth users + `profiles` (admin API
    requirement per spec) and also **compiled `prompt_versions`** + activation pointer —
    a compiled prompt can't be honestly produced from static SQL. Bonus: it re-validates
    the seed configs with the real `AgentConfigSchema` at seed time.
22. Seeded auth users get **auto-generated UUIDs** (admin API doesn't take fixed ids);
    tests resolve users by email login instead. Password `password123`, local only.
23. Fixture `phone_number_id`s (`111000111000111` / `222000222000222`) match the two
    seed tenants; documented in `fixtures/README.md`.
24. **`echo-owner-reply.json` / `history-sync.json` shapes are best-effort
    reconstructions** — Meta's coexistence webhook docs are thin. Flagged hardest for
    replacement with captured payloads (Juan's action item, per spec).
25. Stub signature scheme = HMAC-SHA256 hex in `x-webhook-signature`, secret from
    `WEBHOOK_SECRET` (dev default). Swappable behind `signWebhookPayload`/
    `verifyWebhookSignature` only.

## Tooling notes

26. `pg` (node-postgres) added as a **root dev dependency** for the isolation tests only
    (catalog queries + seed-row lookups). Not an ORM; app code never uses it.
27. Root `pnpm test`/`pnpm typecheck` build `packages/shared` first — `apps/runtime`
    imports its `dist`.
28. Next.js dashboard was hand-scaffolded (layout + placeholder page), not
    `create-next-app`, to keep the tree minimal per "scaffold only, no screens".
29. `db:test` requires `supabase db reset && pnpm seed:auth` first (CI does this; the
    helper error message says so if sign-in fails).

## Skipped / deferred

- No campaign seed rows (spec §8 doesn't list them; `wa_templates` + `segments` cover the
  FK surface, and campaigns tables are fully covered by the isolation matrix).
- No `agent_turns` / `webhook_events` seed rows (runtime-only tables, empty until Phase 1).
- ESLint kept at recommended defaults; not wired into CI (spec lists typecheck + tests +
  DB job only).
- `updated_at` triggers only on tables the spec marks (u).
