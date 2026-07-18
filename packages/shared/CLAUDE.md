# packages/shared

The single source of truth for every type, schema, and contract. If another package
needs a type, it imports it from here — never redeclares it.

## Do

- Export everything through `src/index.ts`.
- Keep `AgentConfigSchema` strict (`.strict()`) with max lengths on all free text; it
  feeds the prompt compiler and the dashboard wizard (structured `path`+`message` errors).
- Bump `COMPILER_VERSION` on ANY change to `src/compiler/` output (templates or logic).
- Keep `compilePrompt` deterministic: no dates, no randomness, no env reads, explicit
  field ordering. The determinism test enforces byte-equality.
- Keep all tenant-authored text inside sanitized data blocks in compiled prompts.
- Regenerate `src/db-types.ts` with `pnpm gen:types` after any migration; commit it.

## Don't

- Don't hand-edit `src/db-types.ts` (generated) or `fixtures/360dialog/*.json` once they
  are replaced by captured payloads (see `fixtures/README.md`).
- Don't add runtime-only or dashboard-only dependencies here. `zod` is the only runtime dep.
- Don't put prices/products into compiled prompts — the agent uses `check_catalog`.
