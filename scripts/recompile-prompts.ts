/**
 * `pnpm recompile:prompts` (ws-d3 §0.4) — the "recompile on compiler bump" op.
 *
 * Recompiles every tenant's PUBLISHED agent_config at the current
 * COMPILER_VERSION and repoints `tenants.active_prompt_version_id` at the fresh
 * `prompt_versions` row. Owed since R2 bumped the compiler to 1.1.0: the seed
 * script only touches the two demo tenants, but a real compiler bump has to roll
 * forward every tenant whose active prompt was compiled by an older version.
 *
 * Idempotent: `prompt_versions` is insert-only (phase-0 immutability), so an
 * identical (compiler_version, compiled_prompt) row is reused rather than
 * duplicated, and a tenant already pointing at the current compilation is left
 * untouched. Safe to re-run; a second run is all no-ops. Logs per-tenant
 * before → after so a bump is auditable.
 *
 * Local-only defaults (Supabase CLI demo keys), same convention as seed-auth.ts.
 */
import { WebSocket } from 'ws';
import { createClient } from '@supabase/supabase-js';

// supabase-js v2 expects a WebSocket global; Node 20 doesn't provide one.
globalThis.WebSocket ??= WebSocket as unknown as typeof globalThis.WebSocket;
// Imported from source so the script works without a prior `pnpm build`.
import { AgentConfigSchema } from '../packages/shared/src/schemas/agent-config.js';
import { compilePrompt } from '../packages/shared/src/compiler/compile-prompt.js';
import { COMPILER_VERSION } from '../packages/shared/src/version.js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
// Well-known supabase-demo service_role JWT shipped with `supabase start`. Local only.
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

interface Counts {
  recompiled: number;
  unchanged: number;
  skipped: number;
}

async function main(): Promise<void> {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: tenants, error: tenantsError } = await supabase
    .from('tenants')
    .select('id, name, vertical, active_prompt_version_id')
    .order('name');
  if (tenantsError) throw tenantsError;

  const counts: Counts = { recompiled: 0, unchanged: 0, skipped: 0 };

  for (const tenant of tenants ?? []) {
    // "before": what the tenant is serving right now.
    let beforeLabel = 'none';
    if (tenant.active_prompt_version_id) {
      const { data: activeVersion, error: activeError } = await supabase
        .from('prompt_versions')
        .select('compiler_version')
        .eq('id', tenant.active_prompt_version_id)
        .maybeSingle();
      if (activeError) throw activeError;
      if (activeVersion) beforeLabel = `${activeVersion.compiler_version} (${short(tenant.active_prompt_version_id)})`;
    }

    const { data: configRow, error: configError } = await supabase
      .from('agent_configs')
      .select('config')
      .eq('tenant_id', tenant.id)
      .eq('status', 'published')
      .maybeSingle();
    if (configError) throw configError;
    if (!configRow) {
      console.log(`${tenant.name}: no published config — skipped`);
      counts.skipped += 1;
      continue;
    }

    // A published config that no longer validates is a data problem, not
    // something to compile past silently. Report it and move on.
    const parsed = AgentConfigSchema.safeParse(configRow.config);
    if (!parsed.success) {
      console.error(
        `${tenant.name}: published config fails AgentConfigSchema — skipped (${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')})`,
      );
      counts.skipped += 1;
      continue;
    }

    const { prompt, compilerVersion } = compilePrompt(parsed.data, { vertical: tenant.vertical });

    // Insert-only: reuse an identical compilation if one already exists.
    const { data: existing, error: existingError } = await supabase
      .from('prompt_versions')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('compiler_version', compilerVersion)
      .eq('compiled_prompt', prompt)
      .maybeSingle();
    if (existingError) throw existingError;

    let versionId = existing?.id;
    if (!versionId) {
      const { data: inserted, error: insertError } = await supabase
        .from('prompt_versions')
        .insert({
          tenant_id: tenant.id,
          compiled_prompt: prompt,
          config_snapshot: parsed.data,
          compiler_version: compilerVersion,
          vertical: tenant.vertical,
        })
        .select('id')
        .single();
      if (insertError) throw insertError;
      versionId = inserted.id;
    }

    if (tenant.active_prompt_version_id === versionId) {
      console.log(`${tenant.name}: ${beforeLabel} — already current, no change`);
      counts.unchanged += 1;
      continue;
    }

    const { error: updateError } = await supabase
      .from('tenants')
      .update({ active_prompt_version_id: versionId })
      .eq('id', tenant.id);
    if (updateError) throw updateError;

    console.log(`${tenant.name}: ${beforeLabel} → ${compilerVersion} (${short(versionId)})`);
    counts.recompiled += 1;
  }

  console.log(
    `recompile:prompts done (compiler ${COMPILER_VERSION}): ` +
      `${counts.recompiled} recompiled, ${counts.unchanged} already current, ${counts.skipped} skipped`,
  );
}

function short(id: string): string {
  return id.slice(0, 8);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
