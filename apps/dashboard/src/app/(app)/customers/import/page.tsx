/**
 * /customers/import — CSV import wizard (WS-D1 §6). Server component loads
 * tenant + defs; parsing/mapping/validation/import run client-side
 * (Papaparse), writes through the lib module with `source: 'import'`.
 */
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { fetchEnabledAttributeDefs } from '@/lib/customers/list';
import { ImportClient } from './import-client';

export default async function CustomersImportPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: profile }, defs] = await Promise.all([
    supabase.from('profiles').select('tenant_id').eq('id', user.id).single(),
    fetchEnabledAttributeDefs(supabase),
  ]);
  if (!profile) redirect('/login');

  return <ImportClient tenantId={profile.tenant_id} defs={defs} />;
}
