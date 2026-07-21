/**
 * /settings — the masters management screen (WS-D4 §2, PRD Screen 7). Admin
 * only: a rep gets a "solo administradores" notice, never the editable UI. All
 * reads are tenant-scoped (anon key + RLS); the writes downstream are admin-only
 * per the phase-0 role matrix, which RLS enforces regardless of this gate.
 */
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { t } from '@/i18n/index';
import { fetchSettingsData } from '@/lib/settings/queries';
import { SettingsClient } from './settings-client';

export default async function SettingsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('tenant_id, role')
    .eq('id', user.id)
    .single();
  if (!profile) redirect('/login');

  if (profile.role !== 'admin') {
    return (
      <div className="flex h-full flex-col">
        <header className="border-b bg-background px-6 py-4">
          <h1 className="text-lg font-semibold">{t('settings.title')}</h1>
        </header>
        <div className="flex flex-1 items-center justify-center p-6">
          <p className="max-w-md text-center text-sm text-muted-foreground">
            {t('settings.adminOnly')}
          </p>
        </div>
      </div>
    );
  }

  const data = await fetchSettingsData(supabase, user.id);

  return <SettingsClient tenantId={profile.tenant_id} data={data} />;
}
