'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth-context';
import { canOperateRole } from '../lib/roles';

/**
 * Shared across every authenticated page (dashboard, /alerts, /book) — not
 * imported into layout.tsx globally, since login has no session yet and
 * shouldn't show a logout button or nav links to protected pages.
 */
export function Header() {
  const { logout, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const onDashboard = pathname === '/dashboard';
  const onAlerts = pathname === '/alerts';
  const onBook = pathname === '/book';
  const showAlerts = canOperateRole(user?.role);

  const roleLabel =
    user?.role === 'TENANT_ADMIN'
      ? 'Admin'
      : user?.role === 'STAFF'
        ? 'Staff'
        : user?.role === 'CLIENT'
          ? 'Client'
          : user?.role === 'SUPER_ADMIN'
            ? 'Super admin'
            : null;

  return (
    <header className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
      <Link href="/dashboard" className="font-display text-lg font-semibold text-ink">
        Booking<span className="text-pine">SaaS</span>
      </Link>
      <nav className="flex flex-wrap items-center gap-2 text-sm">
        {roleLabel && (
          <span className="rounded bg-line px-2 py-1 text-xs font-medium text-ink-600">
            {roleLabel}
          </span>
        )}
        <Link
          href="/dashboard"
          aria-current={onDashboard ? 'page' : undefined}
          className={`rounded px-3 py-1.5 font-medium transition-colors ${
            onDashboard
              ? 'bg-line text-ink'
              : 'text-ink-600 hover:bg-paper hover:text-ink'
          }`}
        >
          Dashboard
        </Link>
        {/* Hidden for CLIENT (and SUPER_ADMIN): the page redirects them too. */}
        {showAlerts && (
          <Link
            href="/alerts"
            aria-current={onAlerts ? 'page' : undefined}
            className={`rounded px-3 py-1.5 font-medium transition-colors ${
              onAlerts
                ? 'bg-line text-ink'
                : 'text-ink-600 hover:bg-paper hover:text-ink'
            }`}
          >
            Alerts
          </Link>
        )}
        <Link
          href="/book"
          aria-current={onBook ? 'page' : undefined}
          className={`rounded px-3 py-1.5 font-medium text-white transition-colors hover:bg-pine-dark ${
            onBook ? 'bg-pine-dark ring-2 ring-pine/30' : 'bg-pine'
          }`}
        >
          New booking
        </Link>
        <button
          type="button"
          onClick={() => {
            logout();
            router.replace('/login');
          }}
          className="rounded px-3 py-1.5 font-medium text-ink-600 transition-colors hover:bg-paper hover:text-ink"
        >
          Sign out
        </button>
      </nav>
    </header>
  );
}
