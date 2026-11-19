import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Booking, Role } from '../../lib/types';
import { makeBooking, pending } from '../../test/helpers';
import AlertsPage from './page';

// Everything the page reads from outside is mocked here: the router, the URL,
// the session and the API. `vi.hoisted` lets the factories below share the
// same mutable state the tests change.
const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  apiFetch: vi.fn(),
  state: {
    search: '',
    role: 'TENANT_ADMIN' as Role | null,
    authenticated: true,
    loading: false,
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace, push: vi.fn() }),
  usePathname: () => '/alerts',
  useSearchParams: () => new URLSearchParams(mocks.state.search),
}));

vi.mock('../../lib/auth-context', () => ({
  useAuth: () => ({
    isAuthenticated: mocks.state.authenticated,
    isLoading: mocks.state.loading,
    user:
      mocks.state.authenticated && mocks.state.role
        ? { id: 'user-1', role: mocks.state.role, tenantId: 'tenant-1' }
        : null,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock('../../lib/api-client', () => ({
  apiFetch: (...args: unknown[]) => mocks.apiFetch(...args),
}));

function jsonResponse(data: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

/** A small real-mode dataset, built around the real clock the page uses. */
function liveBookings(): Booking[] {
  const now = new Date();
  return [
    pending(2, 500, { id: 'live-critical' }, now),
    pending(8, 24 * 60, { id: 'live-high' }, now),
    makeBooking({ id: 'live-ok' }, now),
  ];
}

function listRows() {
  return within(screen.getByRole('list', { name: 'Bookings by urgency' })).getAllByRole('listitem');
}

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.apiFetch.mockReset();
  mocks.state.search = '';
  mocks.state.role = 'TENANT_ADMIN';
  mocks.state.authenticated = true;
  mocks.state.loading = false;
});

describe('/alerts — demo mode', () => {
  beforeEach(() => {
    mocks.state.search = 'demo=1';
  });

  it('shows a visible notice that the data is fictional, and never calls the API', () => {
    render(<AlertsPage />);

    expect(screen.getByRole('status')).toHaveTextContent('Demo data');
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('summarizes the fixtures: 6 need action, KPIs 3 / 3 / 3 / 6', () => {
    render(<AlertsPage />);

    expect(screen.getByText('6 bookings need action.')).toBeInTheDocument();
    const summary = screen.getByRole('list', { name: 'Summary' });
    const tile = (label: string) => within(summary).getByText(label).closest('li');
    expect(tile('Critical')).toHaveTextContent(/Critical\s*3$/);
    expect(tile('High')).toHaveTextContent(/High\s*3$/);
    expect(tile('Upcoming confirmed')).toHaveTextContent(/Upcoming confirmed\s*3$/);
    expect(tile('Closed')).toHaveTextContent(/Closed\s*6$/);
  });

  it('counts the status chips by stored status', () => {
    render(<AlertsPage />);

    for (const name of [
      'All (15)',
      'PENDING (6)',
      'CONFIRMED (4)',
      'CANCELLED (2)',
      'COMPLETED (2)',
      'NO_SHOW (1)',
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('lists the most urgent first: expires in 1 min, then in 2, then the one that starts in 40', () => {
    render(<AlertsPage />);

    const [first, second, third] = listRows();
    expect(first).toHaveTextContent('Expires in 1 min');
    expect(second).toHaveTextContent('Expires in 2 min');
    expect(third).toHaveTextContent('Starts in 40 min');
  });

  it('pages the list: 8 rows, then the rest on "Show more"', async () => {
    const user = userEvent.setup();
    render(<AlertsPage />);

    expect(listRows()).toHaveLength(8);
    await user.click(screen.getByRole('button', { name: 'Show more (7 left)' }));

    expect(listRows()).toHaveLength(15);
    expect(screen.queryByRole('button', { name: /Show more/ })).not.toBeInTheDocument();
  });

  it('filters by status', async () => {
    const user = userEvent.setup();
    render(<AlertsPage />);

    await user.click(screen.getByRole('button', { name: 'PENDING (6)' }));
    expect(listRows()).toHaveLength(6);

    await user.click(screen.getByRole('button', { name: 'NO_SHOW (1)' }));
    expect(listRows()).toHaveLength(1);
  });

  it('shows the finished CONFIRMED under the CONFIRMED chip, labelled as finished', async () => {
    const user = userEvent.setup();
    render(<AlertsPage />);

    await user.click(screen.getByRole('button', { name: 'CONFIRMED (4)' }));

    expect(listRows()).toHaveLength(4);
    const finished = screen.getAllByText('CONFIRMED · ended');
    expect(finished).toHaveLength(1);
    expect(finished[0].closest('li')).toHaveTextContent('Closed');
  });

  it('does not link rows to the dashboard (the data is not real)', () => {
    render(<AlertsPage />);

    expect(screen.queryByRole('link', { name: 'Resolve on the dashboard' })).not.toBeInTheDocument();
  });

  it('offers a search box once there are more than 8 rows', () => {
    render(<AlertsPage />);

    expect(screen.getByRole('searchbox', { name: 'Search bookings' })).toBeInTheDocument();
  });

  it('says so when a search matches nothing', async () => {
    const user = userEvent.setup();
    render(<AlertsPage />);

    await user.type(screen.getByRole('searchbox', { name: 'Search bookings' }), 'zzz-no-match');

    expect(screen.getByText(/No bookings match/)).toBeInTheDocument();
  });
});

describe('/alerts — switching the data source resets the filter', () => {
  it('goes back to "All" when moving from Demo to Live data', async () => {
    const user = userEvent.setup();
    mocks.state.search = 'demo=1';
    mocks.apiFetch.mockResolvedValue(jsonResponse(liveBookings()));
    const { rerender } = render(<AlertsPage />);

    await user.click(screen.getByRole('button', { name: 'PENDING (6)' }));
    expect(screen.getByRole('button', { name: 'PENDING (6)' })).toHaveAttribute('aria-pressed', 'true');

    mocks.state.search = '';
    rerender(<AlertsPage />);

    const all = await screen.findByRole('button', { name: /^All/ });
    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^PENDING/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('goes back to "All" when moving from Live data to Demo', async () => {
    const user = userEvent.setup();
    mocks.apiFetch.mockResolvedValue(jsonResponse(liveBookings()));
    const { rerender } = render(<AlertsPage />);

    await user.click(await screen.findByRole('button', { name: /^PENDING/ }));
    expect(screen.getByRole('button', { name: /^PENDING/ })).toHaveAttribute('aria-pressed', 'true');

    mocks.state.search = 'demo=1';
    rerender(<AlertsPage />);

    expect(screen.getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'true');
    expect(listRows()).toHaveLength(8);
  });
});

describe('/alerts — real data', () => {
  it('shows a loading message, then the list', async () => {
    mocks.apiFetch.mockResolvedValue(jsonResponse(liveBookings()));
    render(<AlertsPage />);

    expect(screen.getByText('Loading bookings…')).toBeInTheDocument();
    await screen.findByRole('list', { name: 'Bookings by urgency' });

    expect(mocks.apiFetch).toHaveBeenCalledWith('/bookings');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(listRows()).toHaveLength(3);
  });

  it('links PENDING rows to the dashboard, where they can be resolved', async () => {
    mocks.apiFetch.mockResolvedValue(jsonResponse(liveBookings()));
    render(<AlertsPage />);
    await screen.findByRole('list', { name: 'Bookings by urgency' });

    const links = screen.getAllByRole('link', { name: 'Resolve on the dashboard' });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', '/dashboard');
  });

  it('puts the critical hold first', async () => {
    mocks.apiFetch.mockResolvedValue(jsonResponse(liveBookings()));
    render(<AlertsPage />);
    await screen.findByRole('list', { name: 'Bookings by urgency' });

    expect(listRows()[0]).toHaveTextContent('Critical');
    expect(listRows()[2]).toHaveTextContent('Normal');
  });

  it('shows the API error with a retry that recovers', async () => {
    const user = userEvent.setup();
    mocks.apiFetch
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse(liveBookings()));
    render(<AlertsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('GET /bookings -> 500');

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await screen.findByRole('list', { name: 'Bookings by urgency' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says so when the tenant has no bookings', async () => {
    mocks.apiFetch.mockResolvedValue(jsonResponse([]));
    render(<AlertsPage />);

    expect(await screen.findByText('No bookings yet for this business.')).toBeInTheDocument();
    expect(screen.getByText('Nothing needs action.')).toBeInTheDocument();
  });

  it('says so when a status has no bookings', async () => {
    const user = userEvent.setup();
    mocks.apiFetch.mockResolvedValue(jsonResponse([makeBooking({ id: 'only' }, new Date())]));
    render(<AlertsPage />);

    await user.click(await screen.findByRole('button', { name: 'PENDING (0)' }));

    expect(screen.getByText('No PENDING bookings.')).toBeInTheDocument();
  });

  it('refetches on "Refresh"', async () => {
    const user = userEvent.setup();
    mocks.apiFetch.mockResolvedValue(jsonResponse(liveBookings()));
    render(<AlertsPage />);
    await screen.findByRole('list', { name: 'Bookings by urgency' });

    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledTimes(2));
  });
});

describe('/alerts — who can see it', () => {
  it.each(['TENANT_ADMIN', 'STAFF'] as const)('%s sees the page', (role) => {
    mocks.state.role = role;
    mocks.state.search = 'demo=1';
    render(<AlertsPage />);

    expect(screen.getByRole('heading', { name: 'Alerts center' })).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it.each(['CLIENT', 'SUPER_ADMIN'] as const)('%s is sent to the dashboard, without fetching', (role) => {
    mocks.state.role = role;
    render(<AlertsPage />);

    expect(mocks.replace).toHaveBeenCalledWith('/dashboard');
    expect(mocks.apiFetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Alerts center' })).not.toBeInTheDocument();
  });

  it('a visitor without a session is sent to the login, without fetching', () => {
    mocks.state.authenticated = false;
    render(<AlertsPage />);

    expect(mocks.replace).toHaveBeenCalledWith('/login');
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('waits for the session to load before redirecting or fetching', () => {
    mocks.state.loading = true;
    render(<AlertsPage />);

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.apiFetch).not.toHaveBeenCalled();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('the header marks Alerts as the current page', () => {
    mocks.state.search = 'demo=1';
    render(<AlertsPage />);
    expect(screen.getByRole('link', { name: 'Alerts' })).toHaveAttribute('aria-current', 'page');
  });
});
