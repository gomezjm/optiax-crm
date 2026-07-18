/**
 * Seed step 2 (after `supabase db reset`): everything seed.sql cannot do.
 *
 *   1. Auth users (admin API) + profiles rows — 1 admin + 1 sales_rep per tenant.
 *   2. Validate each tenant's published agent_config with AgentConfigSchema
 *      (so a drifting seed config fails loudly here, not in Phase 1).
 *   3. Compile the prompt with the real compiler → insert prompt_versions →
 *      point tenants.active_prompt_version_id at it.
 *
 * Idempotent: safe to re-run. Local-only: defaults to the Supabase CLI demo keys.
 */
import { createClient } from '@supabase/supabase-js';
// Imported from source so the script works without a prior `pnpm build`.
import { AgentConfigSchema } from '../packages/shared/src/schemas/agent-config.js';
import { compilePrompt } from '../packages/shared/src/compiler/compile-prompt.js';
import { COMPILER_VERSION } from '../packages/shared/src/version.js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
// Well-known supabase-demo service_role JWT shipped with `supabase start`. Local only.
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

export const SEED_TENANTS = {
  modaValentina: 'aa000000-0001-4000-8000-000000000001',
  saborCasero: 'bb000000-0001-4000-8000-000000000001',
} as const;

/** Known seed logins — also used by supabase/tests. Password is local-only. */
export const SEED_PASSWORD = 'password123';
export const SEED_USERS = [
  {
    email: 'admin@modavalentina.test',
    displayName: 'Valentina García',
    role: 'admin',
    tenantId: SEED_TENANTS.modaValentina,
  },
  {
    email: 'rep@modavalentina.test',
    displayName: 'Laura Mejía',
    role: 'sales_rep',
    tenantId: SEED_TENANTS.modaValentina,
  },
  {
    email: 'admin@saborcasero.test',
    displayName: 'Rosa Delgado',
    role: 'admin',
    tenantId: SEED_TENANTS.saborCasero,
  },
  {
    email: 'rep@saborcasero.test',
    displayName: 'Carlos Ruiz',
    role: 'sales_rep',
    tenantId: SEED_TENANTS.saborCasero,
  },
] as const;

async function main(): Promise<void> {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── 1. Auth users + profiles ──────────────────────────────────────────────
  const { data: userList, error: listError } = await supabase.auth.admin.listUsers({
    perPage: 1000,
  });
  if (listError) throw listError;
  const existingByEmail = new Map(userList.users.map((u) => [u.email, u.id]));

  for (const seedUser of SEED_USERS) {
    let userId = existingByEmail.get(seedUser.email);
    if (!userId) {
      const { data, error } = await supabase.auth.admin.createUser({
        email: seedUser.email,
        password: SEED_PASSWORD,
        email_confirm: true,
      });
      if (error) throw new Error(`createUser(${seedUser.email}): ${error.message}`);
      userId = data.user.id;
      console.log(`created auth user ${seedUser.email}`);
    }

    const { error: profileError } = await supabase.from('profiles').upsert({
      id: userId,
      tenant_id: seedUser.tenantId,
      role: seedUser.role,
      display_name: seedUser.displayName,
    });
    if (profileError) throw new Error(`profiles upsert (${seedUser.email}): ${profileError.message}`);
  }
  console.log(`profiles ready (${SEED_USERS.length} users)`);

  // ── 2 + 3. Validate configs, compile prompts, activate ───────────────────
  for (const tenantId of Object.values(SEED_TENANTS)) {
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('id, name, vertical, active_prompt_version_id')
      .eq('id', tenantId)
      .single();
    if (tenantError) throw tenantError;

    const { data: configRow, error: configError } = await supabase
      .from('agent_configs')
      .select('config')
      .eq('tenant_id', tenantId)
      .eq('status', 'published')
      .single();
    if (configError) throw new Error(`published agent_config missing for ${tenant.name}`);

    // Fails loudly if seed.sql's JSON ever drifts from AgentConfigSchema.
    const config = AgentConfigSchema.parse(configRow.config);
    const { prompt, compilerVersion } = compilePrompt(config, { vertical: tenant.vertical });

    // Idempotency: skip if an identical compiled version already exists.
    const { data: existing, error: existingError } = await supabase
      .from('prompt_versions')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('compiler_version', compilerVersion)
      .eq('compiled_prompt', prompt)
      .maybeSingle();
    if (existingError) throw existingError;

    let versionId = existing?.id as string | undefined;
    if (!versionId) {
      const { data: inserted, error: insertError } = await supabase
        .from('prompt_versions')
        .insert({
          tenant_id: tenantId,
          compiled_prompt: prompt,
          config_snapshot: config,
          compiler_version: compilerVersion,
          vertical: tenant.vertical,
        })
        .select('id')
        .single();
      if (insertError) throw insertError;
      versionId = inserted.id as string;
    }

    if (tenant.active_prompt_version_id !== versionId) {
      const { error: updateError } = await supabase
        .from('tenants')
        .update({ active_prompt_version_id: versionId })
        .eq('id', tenantId);
      if (updateError) throw updateError;
    }
    console.log(`${tenant.name}: prompt compiled (${compilerVersion}) and active`);
  }

  console.log(`seed:auth done (compiler ${COMPILER_VERSION})`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
