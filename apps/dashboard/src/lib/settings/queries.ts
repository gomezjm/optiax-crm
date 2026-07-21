/**
 * Settings reads (WS-D4 §2). Admin-only screen, but the queries themselves are
 * plain tenant-scoped reads (anon key + RLS); the page gates on role before
 * rendering anything editable. No service key.
 */
import type { AgentConfig } from '@optiax/shared';
import type { DashboardSupabaseClient } from '@/lib/supabase/types';
import type { SettingsData, TeamMember } from './types';

/** Pull the published config's capture keys, if a published config exists. */
async function fetchPublishedCaptureKeys(client: DashboardSupabaseClient): Promise<string[]> {
  const { data, error } = await client
    .from('agent_configs')
    .select('config')
    .eq('status', 'published')
    .maybeSingle();
  if (error) throw error;
  if (!data) return [];
  // The config is validated on write (D3); read defensively rather than
  // re-validating the whole thing just to list capture keys.
  const config = data.config as Partial<AgentConfig>;
  const fields = config.capture?.fields ?? [];
  return fields.map((f) => f.key);
}

export async function fetchSettingsData(
  client: DashboardSupabaseClient,
  userId: string,
): Promise<SettingsData> {
  const [profile, attributeDefs, orderStatuses, paymentMethods, team, tenant, captureKeys] =
    await Promise.all([
      client.from('profiles').select('role').eq('id', userId).single(),
      client.from('attribute_defs').select('*').order('is_preset', { ascending: false }).order('label'),
      client.from('order_statuses').select('*').order('sort_order'),
      client.from('payment_methods').select('*').order('label'),
      client.from('profiles').select('id, display_name, role').order('display_name'),
      client.from('tenants').select('wa_channel_status, wa_phone_number_id').single(),
      fetchPublishedCaptureKeys(client),
    ]);

  if (profile.error) throw profile.error;
  if (attributeDefs.error) throw attributeDefs.error;
  if (orderStatuses.error) throw orderStatuses.error;
  if (paymentMethods.error) throw paymentMethods.error;
  if (team.error) throw team.error;
  if (tenant.error) throw tenant.error;

  return {
    role: profile.data.role,
    currentUserId: userId,
    attributeDefs: attributeDefs.data,
    orderStatuses: orderStatuses.data,
    paymentMethods: paymentMethods.data,
    team: team.data as TeamMember[],
    channel: {
      status: tenant.data.wa_channel_status,
      phoneNumberId: tenant.data.wa_phone_number_id,
    },
    publishedCaptureKeys: captureKeys,
  };
}

/**
 * Count of customers that already hold a value under `attributeKey` (delete
 * warning §2). The key is validated snake_case, so it is safe to interpolate
 * into the jsonb path filter. Head-only count.
 */
export async function countCustomersWithAttribute(
  client: DashboardSupabaseClient,
  attributeKey: string,
): Promise<number> {
  const { count, error } = await client
    .from('customers')
    .select('id', { count: 'exact', head: true })
    .not(`attributes->${attributeKey}`, 'is', null);
  if (error) throw error;
  return count ?? 0;
}
