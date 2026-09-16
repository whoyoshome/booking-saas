'use client';

import Link from 'next/link';
import { useAuth } from '../lib/auth-context';

/**
 * Shared across every authenticated page (dashboard, /book) — not
 * imported into layout.tsx globally, since login has no session yet and
 * shouldn't show a logout button or nav links to protected pages.
 */
export function Header() {
  const { logout } = useAuth();

  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b pb-4">
      <Link href="/dashboard" className="text-base font-semibold">
        Booking SaaS
      </Link>
      <nav className="flex flex-wrap items-center gap-2 text-sm">
        <Link
          href="/dashboard"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-gray-800 hover:bg-gray-50"
        >
          Dashboard
        </Link>
        <Link
          href="/book"
          className="rounded-md bg-black px-3 py-1.5 text-white hover:bg-gray-800"
        >
          Nueva reserva
        </Link>
        <button
          type="button"
          onClick={logout}
          className="rounded-md px-3 py-1.5 text-gray-600 hover:bg-gray-100"
        >
          Cerrar sesión
        </button>
      </nav>
    </header>
  );
}
