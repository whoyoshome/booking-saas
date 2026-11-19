import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginPage from '../app/login/page';
import { AuthProvider } from '../lib/auth-context';
import { mockApi, deferred, type FakeResponse } from './support/mock-api';

const push = jest.fn();
let searchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: jest.fn() }),
  useSearchParams: () => searchParams,
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
  await user.click(screen.getByRole('button', { name: 'Ingresar' }));
}

beforeEach(() => {
  push.mockReset();
  searchParams = new URLSearchParams();
  window.localStorage.clear();
});

test('shows the API error message and stays on the page when credentials are rejected', async () => {
  mockApi({
    'POST /auth/login': { status: 401, body: { message: 'Credenciales inválidas.' } },
  });

  renderLogin();
  await fillAndSubmit('cliente@tenant.dev', 'wrong-password');

  expect(await screen.findByText('Credenciales inválidas.')).toBeInTheDocument();
  expect(push).not.toHaveBeenCalled();
  // The form is usable again for a second attempt.
  expect(screen.getByRole('button', { name: 'Ingresar' })).toBeEnabled();
});

test('sends tenant + credentials, disables the button while waiting, then redirects to ?from', async () => {
  searchParams = new URLSearchParams('from=/book');
  const loginResponse = deferred<FakeResponse>();
  const fetchMock = mockApi({
    'POST /auth/login': () => loginResponse.promise,
    'GET /auth/me': { status: 200, body: { id: 'u1', role: 'CLIENT', tenantId: 't1' } },
  });

  renderLogin();
  await fillAndSubmit('cliente@tenant.dev', 'ChangeMe123!');

  // In flight: no double submit possible.
  expect(screen.getByRole('button', { name: 'Ingresando…' })).toBeDisabled();

  const [, init] = fetchMock.mock.calls[0];
  expect(JSON.parse(String(init?.body))).toEqual({
    email: 'cliente@tenant.dev',
    password: 'ChangeMe123!',
    tenantSlug: 'tenant-a', // default option of the tenant select
  });

  loginResponse.resolve({ status: 200, body: { accessToken: 'a', refreshToken: 'r' } });

  await screen.findByRole('button', { name: 'Ingresar' });
  expect(push).toHaveBeenCalledWith('/book');
});
