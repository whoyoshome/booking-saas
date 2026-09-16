'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../lib/auth-context';
import { apiFetch } from '../../lib/api-client';
import { Header } from '../../components/Header';
import { usePagedList } from '../../components/use-paged-list';
import type { Branch, Booking } from '../../lib/types';

function matchBranch(b: Branch, q: string) {
  return `${b.name} ${b.timezone}`.toLowerCase().includes(q);
}

function matchBooking(b: Booking, q: string) {
  return `${b.service?.name ?? ''} ${b.branch?.name ?? ''} ${b.status}`.toLowerCase().includes(q);
}

export default function DashboardPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bookingsError, setBookingsError] = useState<string | null>(null);

  const sortedBookings = useMemo(() => {
    if (!bookings) return [];
    return [...bookings].sort(
      (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
    );
  }, [bookings]);

  const filterBranch = useCallback(matchBranch, []);
  const filterBooking = useCallback(matchBooking, []);
  const branchPage = usePagedList(branches ?? [], filterBranch);
  const bookingPage = usePagedList(sortedBookings, filterBooking);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    if (!isAuthenticated) return;

    apiFetch('/branches')
      .then(async (res) => {
        if (!res.ok) throw new Error(`GET /branches -> ${res.status}`);
        setBranches(await res.json());
      })
      .catch((err: Error) => setError(err.message));

    apiFetch('/bookings')
      .then(async (res) => {
        if (!res.ok) throw new Error(`GET /bookings -> ${res.status}`);
        setBookings(await res.json());
      })
      .catch((err: Error) => setBookingsError(err.message));
  }, [isAuthenticated]);

  if (isLoading || !isAuthenticated) {
    return <main className="p-8">Cargando...</main>;
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <Header />

      {error && (
        <p className="mb-4 text-red-600">
          Error consultando la API: {error}
        </p>
      )}

      {branches === null && !error && <p>Cargando sucursales...</p>}

      {branches !== null && (
        <section className="mb-8">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-sm font-medium text-gray-500">
              Sucursales ({branchPage.total}
              {branchPage.query ? ` de ${branches.length}` : ''})
            </h2>
            {branches.length > 8 && (
              <input
                type="search"
                value={branchPage.query}
                onChange={(e) => branchPage.onQueryChange(e.target.value)}
                placeholder="Buscar sucursal…"
                className="w-full max-w-xs rounded-md border px-3 py-1.5 text-sm"
              />
            )}
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {branchPage.shown.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/book?branchId=${b.id}`}
                  className="flex h-full items-center justify-between rounded-lg border p-3 hover:bg-gray-50"
                >
                  <span>
                    <p className="font-medium">{b.name}</p>
                    <p className="text-sm text-gray-500">{b.timezone}</p>
                  </span>
                  <span className="text-sm text-gray-400">Reservar →</span>
                </Link>
              </li>
            ))}
          </ul>
          {branchPage.remaining > 0 && (
            <button
              type="button"
              onClick={branchPage.showMore}
              className="mt-3 w-full rounded-md border py-2 text-sm hover:bg-gray-50"
            >
              Ver más ({branchPage.remaining} restantes)
            </button>
          )}
          {branches.length === 0 && (
            <p className="text-sm text-gray-500">
              Sin sucursales todavía para este tenant.
            </p>
          )}
        </section>
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-sm font-medium text-gray-500">
            Reservas{bookings !== null ? ` (${bookingPage.total})` : ''}
          </h2>
          {bookings !== null && bookings.length > 8 && (
            <input
              type="search"
              value={bookingPage.query}
              onChange={(e) => bookingPage.onQueryChange(e.target.value)}
              placeholder="Buscar reserva…"
              className="w-full max-w-xs rounded-md border px-3 py-1.5 text-sm"
            />
          )}
        </div>

        {bookingsError && (
          <p className="text-sm text-red-600">
            Error consultando reservas: {bookingsError}
          </p>
        )}

        {bookings === null && !bookingsError && (
          <p className="text-sm text-gray-500">Cargando reservas...</p>
        )}

        {bookings !== null && bookings.length === 0 && !bookingsError && (
          <p className="text-sm text-gray-500">
            Sin reservas todavía —{' '}
            <Link href="/book" className="underline">
              creá la primera
            </Link>
            .
          </p>
        )}

        {bookings !== null && bookings.length > 0 && (
          <>
            <ul className="space-y-2">
              {bookingPage.shown.map((b) => (
                <li key={b.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{b.service?.name ?? b.serviceId}</p>
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs">{b.status}</span>
                  </div>
                  <p className="text-gray-500">
                    {b.branch?.name ?? b.branchId} · {b.staff?.user.email ?? b.staffId}
                  </p>
                  <p className="text-gray-500">
                    {new Date(b.startTime).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
            {bookingPage.remaining > 0 && (
              <button
                type="button"
                onClick={bookingPage.showMore}
                className="mt-3 w-full rounded-md border py-2 text-sm hover:bg-gray-50"
              >
                Ver más ({bookingPage.remaining} restantes)
              </button>
            )}
          </>
        )}
      </section>
    </main>
  );
}
