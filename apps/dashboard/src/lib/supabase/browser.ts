/**
 * Browser Supabase client — anon key + user session; RLS does the scoping.
 * The service-role key must never appear anywhere in the dashboard.
 */
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@optiax/shared';
import { publicSupabaseEnv } from './env';

export function createSupabaseBrowserClient() {
  const { url, anonKey } = publicSupabaseEnv();
  return createBrowserClient<Database>(url, anonKey);
}
