'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { apiFetch, storeTokens, clearTokens, getStoredTokens } from './api-client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface AuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string, tenantSlug?: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Runs once on mount, client-side only — reading localStorage during
  // SSR would throw, and the auth state genuinely doesn't exist until the
  // browser has it.
  useEffect(() => {
    setIsAuthenticated(Boolean(getStoredTokens()));
    setIsLoading(false);
  }, []);

  async function login(email: string, password: string, tenantSlug?: string) {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, tenantSlug }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: 'Login failed.' }));
      throw new Error(body.message ?? 'Login failed.');
    }

    storeTokens(await res.json());
    setIsAuthenticated(true);
  }

  function logout() {
    // Best-effort — the point is clearing local state, not blocking the
    // UI on the API's response to invalidate the refresh token.
    apiFetch('/auth/logout', { method: 'POST' }).catch(() => {});
    clearTokens();
    setIsAuthenticated(false);
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, login, logout }}>
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
