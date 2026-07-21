/**
 * /agent — the configurator, Playground, and Publish flow (ws-d3 §3–§6). Server
 * component: auth + tenant-scoped reads under RLS, then hands the data to the
 * interactive client. The compiled prompt is never read here.
 */
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { fetchAgentScreen } from '@/lib/agent/queries';
import { AgentClient } from './agent-client';

export default async function AgentPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const data = await fetchAgentScreen(supabase, user.id);
  return <AgentClient data={data} />;
}
