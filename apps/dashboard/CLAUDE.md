# apps/dashboard

Next.js (App Router) scaffold. **No screens in Phase 0** — they arrive in later phases
(configurator wizard, inbox, customers, orders, campaigns).

## Do

- Import every type/schema from `@optiax/shared` (e.g. `AgentConfigSchema` for the wizard,
  `Database` for supabase-js typing).
- Talk to Supabase directly with the anon key + user session; RLS does the scoping.
- Render config validation errors from `validateAgentConfig`'s structured `path`+`message` list.
- Put user-facing strings in `es.json` once screens exist — no hardcoded copy.

## Don't

- Don't use the service-role key here, ever.
- Don't edit raw prompts in the UI — the dashboard edits structured config JSON only.
- Don't add screens, routes, or product features while this is Phase 0.
