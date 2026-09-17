import { NextResponse, type NextRequest } from 'next/server';

/**
 * DESIGN NOTE — what this cookie is, and what it deliberately is NOT.
 *
 * `bk_session` is a presence flag ("1" or absent), set/cleared client-side
 * by lib/auth-context.tsx right alongside the real access/refresh tokens
 * (which stay in localStorage, unchanged from before this pass). It holds
 * no token value and is NOT httpOnly.
 *
 * This middleware uses it purely for edge-level UX routing: redirect an
 * unauthenticated visitor away from /dashboard and /book before the page
 * ships any JS, and redirect an already-authenticated visitor away from
 * /login. It is NOT the security boundary — it can't be, a client-set
 * cookie is just as forgeable as the localStorage flag it mirrors. Every
 * protected API call is still authorized for real by the Bearer access
 * token NestJS validates on each request, and PostgreSQL RLS enforces
 * tenant isolation at the database engine level regardless of what this
 * cookie says (see apps/api's Fase 3 design notes). Worst case if someone
 * forges this cookie: they see a client shell that immediately 401s on
 * its first real API call — not a data leak.
 *
 * NEXT LEVEL (deliberately not built in this pass, same "designed, not
 * applied" posture as docs/aws-target.md): move the refresh token into an
 * httpOnly cookie set by a Next.js Route Handler that proxies
 * /auth/login and /auth/refresh, keep the short-lived access token in
 * memory only (never localStorage), and have this middleware read that
 * httpOnly cookie instead. That's a real security hardening step, but it
 * touches the tested auth flow on both apps/web and apps/api's CORS
 * config — worth doing once it can be verified against the existing e2e
 * suite, not blind.
 */
const SESSION_COOKIE = 'bk_session';

const PROTECTED_PREFIXES = ['/dashboard', '/book'];

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
  matcher: ['/', '/login', '/dashboard/:path*', '/book/:path*'],
};
