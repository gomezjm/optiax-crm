/**
 * Module-private service-role client factory. This file must never be imported
 * from outside `src/db/` — the eslint `no-restricted-imports` rule and the
 * import-restriction unit test both enforce it. Everything the rest of the
 * runtime needs goes through the repository surface in `./index.ts`.
 */
import { WebSocket } from 'ws';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@optiax/shared';

// supabase-js v2 expects a WebSocket global; Node 20 doesn't provide one.
globalThis.WebSocket ??= WebSocket as unknown as typeof globalThis.WebSocket;

export type ServiceClient = SupabaseClient<Database>;

export function createServiceClient(opts: { url: string; serviceRoleKey: string }): ServiceClient {
  return createClient<Database>(opts.url, opts.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
