import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '../lib/types';
import { Header } from './Header';

const mocks = vi.hoisted(() => ({
  pathname: '/dashboard',
  role: 'TENANT_ADMIN' as Role | null,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => mocks.pathname,
}));

vi.mock('../lib/auth-context', () => ({
  useAuth: () => ({
    user: mocks.role ? { id: 'user-1', role: mocks.role, tenantId: 'tenant-1' } : null,
    logout: vi.fn(),
  }),
}));

beforeEach(() => {
  mocks.pathname = '/dashboard';
  mocks.role = 'TENANT_ADMIN';
});

describe('Header — Alerts link', () => {
  it.each(['TENANT_ADMIN', 'STAFF'] as const)('is shown to %s', (role) => {
    mocks.role = role;
    render(<Header />);

    expect(screen.getByRole('link', { name: 'Alerts' })).toHaveAttribute('href', '/alerts');
  });

  it.each(['CLIENT', 'SUPER_ADMIN'] as const)('is hidden from %s', (role) => {
    mocks.role = role;
    render(<Header />);

    expect(screen.queryByRole('link', { name: 'Alerts' })).not.toBeInTheDocument();
  });

  it('is hidden while the user is not known yet', () => {
    mocks.role = null;
    render(<Header />);

    expect(screen.queryByRole('link', { name: 'Alerts' })).not.toBeInTheDocument();
  });
});

describe('Header — current page', () => {
  it.each([
    ['/dashboard', 'Dashboard'],
    ['/alerts', 'Alerts'],
    ['/book', 'New booking'],
  ])('on %s only "%s" is marked as the current page', (pathname, current) => {
    mocks.pathname = pathname;
    render(<Header />);

    const marked = screen.getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page');
    expect(marked).toHaveLength(1);
    expect(marked[0]).toHaveTextContent(current);
  });
});
