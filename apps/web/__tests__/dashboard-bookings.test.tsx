import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DashboardPage from '../app/dashboard/page';
import { AuthProvider } from '../lib/auth-context';
import type { Booking, Role } from '../lib/types';
import { mockApi, seedSession } from './support/mock-api';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

function booking(overrides: Partial<Booking>): Booking {
  return {
    id: 'b',
    staffId: 's1',
    serviceId: 'sv1',
    branchId: 'br1',
    clientId: 'c1',
    startTime: '2026-09-14T15:00:00.000Z',
    endTime: '2026-09-14T15:30:00.000Z',
    status: 'PENDING',
    branch: { name: 'Sucursal Centro' },
    staff: { user: { email: 'ana@tenant-a.dev' } },
    client: { email: 'cliente@tenant.dev' },
    ...overrides,
  };
}

// The CONFIRMED one is the most recent: if the UI sorted only by date it
// would come first. PENDING must still be on top — it's what needs action.
const BOOKINGS: Booking[] = [
  booking({ id: 'confirmed-1', status: 'CONFIRMED', service: { name: 'Coloración' }, startTime: '2026-09-20T15:00:00.000Z' }),
  booking({ id: 'pending-1', status: 'PENDING', service: { name: 'Corte de cabello' }, startTime: '2026-09-14T15:00:00.000Z' }),
];

function renderDashboard(role: Role, extraRoutes = {}) {
  seedSession();
  const fetchMock = mockApi({
    'GET /auth/me': { status: 200, body: { id: 'u1', role, tenantId: 't1' } },
    'GET /branches': { status: 200, body: [] },
    'GET /bookings': { status: 200, body: BOOKINGS },
    ...extraRoutes,
  });
  render(
    <AuthProvider>
      <DashboardPage />
    </AuthProvider>,
  );
  return fetchMock;
}

async function bookingRows() {
  await screen.findByText('Corte de cabello');
  return screen.getAllByRole('listitem');
}

beforeEach(() => window.localStorage.clear());

test.each([
  ['TENANT_ADMIN', ['Aceptar', 'Rechazar']],
  ['CLIENT', ['Cancelar solicitud']],
] as const)(
  'lists PENDING first and shows %s only the actions its role allows',
  async (role, expectedActions) => {
    renderDashboard(role);

    const [first, second] = await bookingRows();
    expect(within(first).getByText('Corte de cabello')).toBeInTheDocument();
    expect(within(first).getByText('PENDING')).toBeInTheDocument();
    expect(within(second).getByText('CONFIRMED')).toBeInTheDocument();

    const actions = within(first)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(actions).toEqual(expectedActions);
    // Nothing is actionable on a booking that is no longer PENDING.
    expect(within(second).queryByRole('button')).not.toBeInTheDocument();
  },
);

test('accepting a pending booking calls PATCH /confirm and updates the row to CONFIRMED', async () => {
  const fetchMock = renderDashboard('TENANT_ADMIN', {
    'PATCH /bookings/pending-1/confirm': { status: 200, body: {} },
  });

  const [pendingRow] = await bookingRows();
  await userEvent.click(within(pendingRow).getByRole('button', { name: 'Aceptar' }));

  expect(await within(pendingRow).findByText('CONFIRMED')).toBeInTheDocument();
  expect(within(pendingRow).queryByRole('button')).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith(
    'http://localhost:3001/bookings/pending-1/confirm',
    expect.objectContaining({ method: 'PATCH' }),
  );
});
