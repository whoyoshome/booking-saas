const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

const STORAGE_KEY = 'booking_saas_tokens';

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
}

export function clearTokens(): void {
  window.localStorage.removeItem(STORAGE_KEY);
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
