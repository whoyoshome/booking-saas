import { NextResponse, type NextRequest } from 'next/server';

/**
 * `bk_session` is a presence flag ("1" or absent) set client-side by
 * lib/auth-context.tsx next to the real tokens in localStorage. It holds no
 * token and is not httpOnly.
 *
 * This middleware only does UX routing: unauthenticated visitors are sent
 * away from protected pages before any JS ships, and signed-in visitors
 * away from /login. It is NOT a security boundary: the cookie is forgeable,
 * every API call is authorized by the Bearer token, and PostgreSQL RLS
 * enforces tenant isolation. A forged cookie only yields a shell whose
 * first API call returns 401.
 *
 * Possible hardening: keep the refresh token in an httpOnly cookie set by a
 * Route Handler that proxies /auth/login and /auth/refresh, hold the access
 * token in memory only, and read that cookie here.
 */
const SESSION_COOKIE = 'bk_session';

const PROTECTED_PREFIXES = ['/dashboard', '/alerts', '/book'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.get(SESSION_COOKIE)?.value === '1';

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (isProtected && !hasSession) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname === '/login' && hasSession) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  if (pathname === '/') {
    return NextResponse.redirect(new URL(hasSession ? '/dashboard' : '/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/login', '/dashboard/:path*', '/alerts/:path*', '/book/:path*'],
};
