/**
 * Authenticated app shell (WS-D1 §1): sidebar nav + content pane. Every
 * dashboard screen lives inside this route group; the sidebar is the only
 * place that renders tenant identity and the user menu.
 */
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Toaster } from '@/components/ui/sonner';
import { AppSidebar } from '@/components/shell/app-sidebar';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: tenant } = await supabase.from('tenants').select('name').single();

  return (
    <div className="flex h-screen overflow-hidden">
      <AppSidebar tenantName={tenant?.name ?? ''} userEmail={user.email ?? ''} />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      <Toaster position="bottom-right" />
    </div>
  );
}
