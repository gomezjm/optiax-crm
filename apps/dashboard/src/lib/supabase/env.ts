/**
 * NEXT_PUBLIC_* env access. The literal `process.env.NEXT_PUBLIC_…` references
 * are required for Next.js build-time inlining — don't refactor into dynamic
 * lookups.
 */
export function publicSupabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY — copy .env.example to .env.local',
    );
  }
  return { url, anonKey };
}
