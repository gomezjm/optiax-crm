/**
 * Client-side writes for the /agent screen (ws-d3 §3). Anon key + session; RLS
 * enforces that only an admin can write `agent_configs` / `tenants`. The
 * compile + publish writes (prompt_versions, active pointer) do NOT happen here —
 * they go through the runtime's authenticated /publish endpoint (§6).
 */
import type { AgentConfig, Json } from '@optiax/shared';
import type { DashboardSupabaseClient } from '@/lib/supabase/types';

/** Upsert the tenant's single draft config row (one-draft-per-tenant). */
export async function saveDraft(
  client: DashboardSupabaseClient,
  tenantId: string,
  config: AgentConfig,
): Promise<void> {
  const { data: existing, error: selectError } = await client
    .from('agent_configs')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('status', 'draft')
    .maybeSingle();
  if (selectError) throw selectError;

  if (existing) {
    const { error } = await client
      .from('agent_configs')
      .update({ config: config as unknown as Json })
      .eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await client
      .from('agent_configs')
      .insert({ tenant_id: tenantId, config: config as unknown as Json, status: 'draft' });
    if (error) throw error;
  }
}

/** Flip the master toggle (`tenants.agent_enabled`). Admin-only via RLS. */
export async function setAgentEnabled(
  client: DashboardSupabaseClient,
  tenantId: string,
  enabled: boolean,
): Promise<void> {
  const { error } = await client.from('tenants').update({ agent_enabled: enabled }).eq('id', tenantId);
  if (error) throw error;
}
