import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../lib/auth-context';
import type { Booking, Role } from '../../lib/types';
import { makeBooking } from '../../test/helpers';
import { mockApi, seedSession } from '../../test/mock-api';
import DashboardPage from './page';

// Only the router and `fetch` are fake: AuthProvider (which asks
// GET /auth/me for the role) and apiFetch are the real code.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/dashboard',
}));

// The CONFIRMED one is the most recent: if the UI sorted only by date it
// would come first. PENDING must still be on top — it's what needs action.
const BOOKINGS: Booking[] = [
  makeBooking({
    id: 'confirmed-1',
    status: 'CONFIRMED',
    service: { name: 'Hair color' },
    startTime: '2026-09-20T15:00:00.000Z',
  }),
  makeBooking({
    id: 'pending-1',
    status: 'PENDING',
    service: { name: 'Haircut' },
    startTime: '2026-09-14T15:00:00.000Z',
  }),
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
  await screen.findByText('Haircut');
  return screen.getAllByRole('listitem');
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('/dashboard — bookings list', () => {
  it.each([
    ['TENANT_ADMIN', ['Accept', 'Reject']],
    ['CLIENT', ['Cancel request']],
  ] as const)('lists PENDING first and shows %s only the actions its role allows', async (role, expectedActions) => {
    renderDashboard(role);

    const [first, second] = await bookingRows();
    expect(within(first).getByText('Haircut')).toBeInTheDocument();
    expect(within(first).getByText('PENDING')).toBeInTheDocument();
    expect(within(second).getByText('CONFIRMED')).toBeInTheDocument();

    const actions = within(first)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(actions).toEqual(expectedActions);
    // Nothing is actionable on a booking that is no longer PENDING.
    expect(within(second).queryByRole('button')).not.toBeInTheDocument();
  });

  it('accepting a pending booking calls PATCH /confirm and updates the row to CONFIRMED', async () => {
    const fetchMock = renderDashboard('TENANT_ADMIN', {
      'PATCH /bookings/pending-1/confirm': { status: 200, body: {} },
    });

    const [pendingRow] = await bookingRows();
    await userEvent.click(within(pendingRow).getByRole('button', { name: 'Accept' }));

    expect(await within(pendingRow).findByText('CONFIRMED')).toBeInTheDocument();
    expect(within(pendingRow).queryByRole('button')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/bookings/pending-1/confirm',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });
});
