'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth-context';

/**
 * Shared across every authenticated page (dashboard, /book) — not
 * imported into layout.tsx globally, since login has no session yet and
 * shouldn't show a logout button or nav links to protected pages.
 */
export function Header() {
  const { logout } = useAuth();
  const router = useRouter();

  return (
    <header className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
      <Link href="/dashboard" className="font-display text-lg font-semibold text-ink">
        Booking<span className="text-pine">SaaS</span>
      </Link>
      <nav className="flex flex-wrap items-center gap-2 text-sm">
        <Link
          href="/dashboard"
          className="rounded px-3 py-1.5 font-medium text-ink-600 transition-colors hover:bg-paper hover:text-ink"
        >
          Dashboard
        </Link>
        <Link
          href="/book"
          className="rounded bg-pine px-3 py-1.5 font-medium text-white transition-colors hover:bg-pine-dark"
        >
          Nueva reserva
        </Link>
        <button
          type="button"
          onClick={() => {
            logout();
            router.replace('/login');
          }}
          className="rounded px-3 py-1.5 font-medium text-ink-600 transition-colors hover:bg-paper hover:text-ink"
        >
          Cerrar sesión
        </button>
      </nav>
    </header>
  );
}
