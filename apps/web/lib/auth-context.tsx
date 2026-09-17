'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  apiFetch,
  storeTokens,
  clearTokens,
  syncSessionCookie,
  type TokenPair,
} from './api-client';
import type { AuthUser } from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface AuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: AuthUser | null;
  login: (email: string, password: string, tenantSlug?: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);

  // GET /auth/me is the ONLY source for `role` — never decode the JWT
  // client-side. The access token's signature isn't something client JS
  // can verify, so a value pulled out of it can't be trusted for a role
  // check; asking the API (which already validates the signature via
  // JwtAuthGuard) is the only honest way to know who the session is.
  async function loadCurrentUser(): Promise<boolean> {
    try {
      const res = await apiFetch('/auth/me');
      if (!res.ok) {
        setUser(null);
        return false;
      }
      setUser((await res.json()) as AuthUser);
      return true;
    } catch {
      setUser(null);
      return false;
    }
  }

  // Runs once on mount, client-side only — reading localStorage during
  // SSR would throw, and the auth state genuinely doesn't exist until the
  // browser has it. When a session already exists (page refresh, not a
  // fresh login), `role` isn't in localStorage at all — it has to be
  // fetched here too, which is why isLoading stays true until
  // loadCurrentUser resolves, not just until the cookie check runs.
  // Tokens without a successful /auth/me are not a session: otherwise the
  // dashboard would render as "logged in" with no role and hide Confirm.
  useEffect(() => {
    const hasTokens = syncSessionCookie();

    const finish = () => setIsLoading(false);

    if (hasTokens) {
      loadCurrentUser()
        .then((ok) => {
          if (ok) {
            setIsAuthenticated(true);
          } else {
            clearTokens();
            setIsAuthenticated(false);
          }
        })
        .finally(finish);
    } else {
      setIsAuthenticated(false);
      finish();
    }

    const onSessionEnded = () => {
      setIsAuthenticated(false);
      setUser(null);
    };
    window.addEventListener('booking-saas-session-ended', onSessionEnded);
    return () => window.removeEventListener('booking-saas-session-ended', onSessionEnded);
  }, []);

  async function login(email: string, password: string, tenantSlug?: string) {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, tenantSlug }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({ message: 'Login failed.' }))) as {
        message?: string;
      };
      throw new Error(body.message ?? 'Login failed.');
    }

    storeTokens((await res.json()) as TokenPair);
    const ok = await loadCurrentUser();
    if (!ok) {
      clearTokens();
      setIsAuthenticated(false);
      throw new Error('No se pudo cargar el perfil. Intentá de nuevo.');
    }
    setIsAuthenticated(true);
  }

  function logout() {
    // Best-effort — the point is clearing local state, not blocking the
    // UI on the API's response to invalidate the refresh token.
    apiFetch('/auth/logout', { method: 'POST' }).catch(() => {});
    clearTokens();
    setIsAuthenticated(false);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within <AuthProvider>.');
  }
  return ctx;
}
