/**
 * Shared client type for typed query modules. Lives inside lib/supabase so the
 * `@supabase/supabase-js` import stays behind the fence (eslint
 * no-restricted-imports); everything else references this alias.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@optiax/shared';

export type DashboardSupabaseClient = SupabaseClient<Database>;
