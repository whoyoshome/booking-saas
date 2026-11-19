import { vi } from 'vitest';

/**
 * Fakes the network boundary for tests that keep the real AuthProvider and
 * apiFetch in the loop (login, dashboard, AiAssistBox): only `fetch` is
 * replaced, so a test breaks if the UI stops talking to the API the way
 * the API expects. Pair with `vi.unstubAllGlobals()` in afterEach.
 *
 * Routes are keyed "METHOD /path" (query string included). A handler can
 * return a response directly or a promise, which lets a test hold a
 * request "in flight" to assert the loading state.
 */
export interface FakeResponse {
  status: number;
  body?: unknown;
}

type Handler = (init: RequestInit | undefined) => FakeResponse | Promise<FakeResponse>;

const API_URL = 'http://localhost:3001';

export function mockApi(routes: Record<string, Handler | FakeResponse>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const path = url.startsWith(API_URL) ? url.slice(API_URL.length) : url;
    const key = `${(init?.method ?? 'GET').toUpperCase()} ${path}`;
    const route = routes[key];
    if (!route) {
      throw new Error(`Unexpected request in test: ${key}`);
    }
    const { status, body } = typeof route === 'function' ? await route(init) : route;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** A promise the test resolves by hand — keeps a request pending. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Puts a session in localStorage the same way a real login leaves it. */
export function seedSession() {
  window.localStorage.setItem(
    'booking_saas_tokens',
    JSON.stringify({ accessToken: 'test-access', refreshToken: 'test-refresh' }),
  );
}
