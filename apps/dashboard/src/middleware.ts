/**
 * Session refresh + route guard: every app route requires a signed-in user; a
 * signed-in user hitting `/login` goes straight to the inbox.
 */
import type { NextRequest } from 'next/server';
import { updateSession } from './lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    '/inbox/:path*',
    '/customers/:path*',
    '/home',
    '/orders/:path*',
    '/products/:path*',
    '/campaigns',
    '/agent',
    '/settings',
    '/login',
  ],
};
