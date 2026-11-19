import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../lib/auth-context';
import { deferred, mockApi, type FakeResponse } from '../../test/mock-api';
import LoginPage from './page';

// Only the router and `fetch` are fake: AuthProvider, apiFetch and token
// storage are the real code.
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  search: '',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));

function renderLogin() {
  return render(
    <AuthProvider>
      <LoginPage />
    </AuthProvider>,
  );
}

async function fillAndSubmit(email: string, password: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

beforeEach(() => {
  mocks.push.mockReset();
  mocks.search = '';
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('/login', () => {
  it('shows the API error message and stays on the page when credentials are rejected', async () => {
    mockApi({
      'POST /auth/login': { status: 401, body: { message: 'Credenciales inválidas.' } },
    });

    renderLogin();
    await fillAndSubmit('cliente@tenant.dev', 'wrong-password');

    expect(await screen.findByText('Credenciales inválidas.')).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
    // The form is usable again for a second attempt.
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('sends tenant + credentials, disables the button while waiting, then redirects to ?from', async () => {
    mocks.search = 'from=/book';
    const loginResponse = deferred<FakeResponse>();
    const fetchMock = mockApi({
      'POST /auth/login': () => loginResponse.promise,
      'GET /auth/me': { status: 200, body: { id: 'u1', role: 'CLIENT', tenantId: 't1' } },
    });

    renderLogin();
    await fillAndSubmit('cliente@tenant.dev', 'ChangeMe123!');

    // In flight: no double submit possible.
    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'cliente@tenant.dev',
      password: 'ChangeMe123!',
      tenantSlug: 'tenant-a', // default option of the tenant select
    });

    loginResponse.resolve({ status: 200, body: { accessToken: 'a', refreshToken: 'r' } });

    await screen.findByRole('button', { name: 'Sign in' });
    expect(mocks.push).toHaveBeenCalledWith('/book');
  });
});
