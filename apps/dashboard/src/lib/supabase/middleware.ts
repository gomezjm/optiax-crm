/**
 * Middleware-scoped Supabase session handling (cookie refresh) + route guard
 * decisions. Kept here so `@supabase/ssr` is only imported under lib/supabase.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import type { Database } from '@optiax/shared';
import { publicSupabaseEnv } from './env';

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const { url, anonKey } = publicSupabaseEnv();

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  if (!user && path.startsWith('/inbox')) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  if (user && path === '/login') {
    return NextResponse.redirect(new URL('/inbox', request.url));
  }
  return response;
}
