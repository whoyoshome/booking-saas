const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

const STORAGE_KEY = 'booking_saas_tokens';

// Mirrors token presence for middleware.ts — NOT the token itself, and
// NOT httpOnly (a client script sets it, so a client script could forge
// it too). See middleware.ts's design note for exactly what this cookie
// does and does not guarantee. Matches the refresh token's real lifetime
// (7 days, JWT_REFRESH_EXPIRES_IN in the API's .env) so the edge redirect
// and the actual session expire on the same schedule.
const SESSION_COOKIE = 'bk_session';
const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function cookieSecureSuffix(): string {
  return window.location.protocol === 'https:' ? '; secure' : '';
}

function setSessionCookie(): void {
  document.cookie = `${SESSION_COOKIE}=1; path=/; max-age=${SESSION_COOKIE_MAX_AGE_SECONDS}; samesite=lax${cookieSecureSuffix()}`;
}

function clearSessionCookie(): void {
  document.cookie = `${SESSION_COOKIE}=; path=/; max-age=0; samesite=lax${cookieSecureSuffix()}`;
}

/** Keep the edge cookie in sync with tokens already in localStorage (e.g. after this cookie was introduced, or cookies were cleared). */
export function syncSessionCookie(): boolean {
  if (typeof window === 'undefined') return false;
  if (getStoredTokens()) {
    setSessionCookie();
    return true;
  }
  clearSessionCookie();
  return false;
}

export function getStoredTokens(): TokenPair | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TokenPair;
  } catch {
    return null;
  }
}

export function storeTokens(tokens: TokenPair): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
  setSessionCookie();
}

export function clearTokens(): void {
  window.localStorage.removeItem(STORAGE_KEY);
  clearSessionCookie();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('booking-saas-session-ended'));
  }
}

async function refreshTokens(): Promise<TokenPair | null> {
  const current = getStoredTokens();
  if (!current) return null;

  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: current.refreshToken }),
  });
  if (!res.ok) return null;

  const tokens = (await res.json()) as TokenPair;
  storeTokens(tokens);
  return tokens;
}

/**
 * Fetch wrapper that attaches the current access token and transparently
 * retries ONCE with a refreshed token pair on 401 — mirrors the rotation
 * flow the API has had since Fase 2 (Auth): the used refresh token is
 * invalidated server-side the moment it's used, so this can only ever
 * retry once per call, never loop.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const tokens = getStoredTokens();

  const doFetch = (accessToken?: string) =>
    fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...init.headers,
      },
    });

  let res = await doFetch(tokens?.accessToken);

  if (res.status === 401 && tokens) {
    const refreshed = await refreshTokens();
    if (refreshed) {
      res = await doFetch(refreshed.accessToken);
    } else {
      clearTokens();
    }
  }

  return res;
}
