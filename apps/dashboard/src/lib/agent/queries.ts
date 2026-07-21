/**
 * Server-side reads for the /agent screen (ws-d3 §3, §5, §6). Anon key + session;
 * RLS scopes everything to the caller's tenant. The compiled prompt is never
 * read here — the dashboard edits structured config only.
 */
import { validateAgentConfig, type AgentConfig } from '@optiax/shared';
import type { DashboardSupabaseClient } from '@/lib/supabase/types';
import { buildCaptureOptions } from './capture-fields';
import type { AgentScreenData } from './types';

/** Parse a stored config jsonb; null when it fails validation (treated as absent). */
function parseConfig(raw: unknown): AgentConfig | null {
  const result = validateAgentConfig(raw);
  return result.ok ? result.config : null;
}

export async function fetchAgentScreen(
  supabase: DashboardSupabaseClient,
  userId: string,
): Promise<AgentScreenData> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('tenant_id, role')
    .eq('id', userId)
    .single();
  if (!profile) throw new Error('no profile for user');

  const [{ data: tenant }, { data: configs }, { data: attributeDefs }] = await Promise.all([
    supabase.from('tenants').select('agent_enabled, active_prompt_version_id, currency').single(),
    supabase.from('agent_configs').select('config, status'),
    supabase.from('attribute_defs').select('key, label').eq('enabled', true).order('label'),
  ]);

  const draftRow = configs?.find((c) => c.status === 'draft') ?? null;
  const publishedRow = configs?.find((c) => c.status === 'published') ?? null;
  const draft = draftRow ? parseConfig(draftRow.config) : null;
  const published = publishedRow ? parseConfig(publishedRow.config) : null;

  // "differs" only when a distinct draft row exists whose content is not the
  // published content (a byte compare on canonical JSON is enough here).
  const draftDiffers =
    draft !== null && JSON.stringify(draft) !== JSON.stringify(published);

  let publishedAt: string | null = null;
  let publishedCompilerVersion: string | null = null;
  if (tenant?.active_prompt_version_id) {
    const { data: version } = await supabase
      .from('prompt_versions')
      .select('created_at, compiler_version')
      .eq('id', tenant.active_prompt_version_id)
      .maybeSingle();
    publishedAt = version?.created_at ?? null;
    publishedCompilerVersion = version?.compiler_version ?? null;
  }

  return {
    role: profile.role,
    tenantId: profile.tenant_id,
    currency: tenant?.currency ?? 'COP',
    agentEnabled: tenant?.agent_enabled ?? false,
    draft,
    published,
    draftDiffers,
    publishedAt,
    publishedCompilerVersion,
    captureOptions: buildCaptureOptions(attributeDefs ?? []),
  };
}
