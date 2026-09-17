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

// Status carries meaning through color, not just text — same three-color
// system used across the app (pine = confirmed/good, gold = pending/needs
// attention, rust = cancelled/failed). COMPLETED and NO_SHOW share the
// neutral/rust treatment since they're both "no longer actionable".
const STATUS_STYLE: Record<Booking['status'], string> = {
  PENDING: 'bg-gold-bg text-gold-dark',
  CONFIRMED: 'bg-pine-bg text-pine-dark',
  CANCELLED: 'bg-rust-bg text-rust-dark',
  COMPLETED: 'bg-line text-ink-600',
  NO_SHOW: 'bg-rust-bg text-rust-dark',
};

const searchInputClass =
  'w-full max-w-xs rounded-md border border-line bg-surface px-3 py-1.5 text-sm placeholder:text-ink-400 focus-visible:border-pine';

const actionButtonClass =
  'rounded border px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';

type BookingAction = 'confirm' | 'cancel';

export default function DashboardPage() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const router = useRouter();
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bookingsError, setBookingsError] = useState<string | null>(null);

  // Who can act on a PENDING booking from this list — mirrors the API's
  // own @Roles(TENANT_ADMIN, STAFF) on PATCH /bookings/:id/confirm.
  // /cancel is deliberately more permissive server-side (a CLIENT can
  // cancel their own booking — see BookingsService.cancel), but that's a
  // different, not-yet-built surface; this dashboard is the admin/staff
  // operational view, so it only ever shows these two roles the buttons.
  const canOperate = user?.role === 'TENANT_ADMIN' || user?.role === 'STAFF';

  // Single in-flight id, not a Set — only one row can realistically be
  // mid-request at a time from a single click, and disabling every row's
  // buttons while any one action is in flight (not just the row being
  // acted on) avoids a second click landing on stale local state while
  // the first PATCH is still resolving.
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

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

  const refreshBookings = useCallback(async () => {
    try {
      const res = await apiFetch('/bookings');
      if (!res.ok) throw new Error(`GET /bookings -> ${res.status}`);
      setBookings((await res.json()) as Booking[]);
      setBookingsError(null);
    } catch (err) {
      setBookingsError(err instanceof Error ? err.message : 'No se pudo refrescar la lista.');
    }
  }, []);

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
        setBranches((await res.json()) as Branch[]);
      })
      .catch((err: Error) => setError(err.message));

    refreshBookings();
  }, [isAuthenticated, refreshBookings]);

  // Confirm and cancel share everything except the path segment and the
  // resulting status, so one handler covers both instead of two near-
  // identical copies.
  async function handleBookingAction(id: string, action: BookingAction) {
    setActioningId(id);
    setRowError(null);

    try {
      const res = await apiFetch(`/bookings/${id}/${action}`, { method: 'PATCH' });

      if (res.ok) {
        const nextStatus: Booking['status'] = action === 'confirm' ? 'CONFIRMED' : 'CANCELLED';
        setBookings((prev) =>
          prev ? prev.map((b) => (b.id === id ? { ...b, status: nextStatus } : b)) : prev,
        );
        return;
      }

      // 400/404 means our local copy of this row is stale — most likely
      // someone else (another admin, or the pending-expiry cron) already
      // moved it out of PENDING between us loading the list and clicking
      // here. Show the API's own message, then pull the real list instead
      // of guessing what state it's actually in now.
      const body = (await res.json().catch(() => ({}))) as {
        message?: string | string[];
      };
      const apiMessage = Array.isArray(body.message)
        ? body.message.join(' ')
        : body.message;
      setRowError({
        id,
        message:
          apiMessage ??
          `No se pudo ${action === 'confirm' ? 'confirmar' : 'cancelar'} (${res.status}).`,
      });
      await refreshBookings();
    } catch (err) {
      setRowError({
        id,
        message: err instanceof Error ? err.message : 'Error de red — intentá de nuevo.',
      });
    } finally {
      setActioningId(null);
    }
  }

  if (isLoading || !isAuthenticated) {
    return <main className="p-8 text-sm text-ink-600">Cargando…</main>;
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <Header />

      {error && (
        <p className="mb-4 rounded bg-rust-bg px-3 py-2 text-sm text-rust-dark">
          Error consultando la API: {error}
        </p>
      )}

      {branches === null && !error && <p className="text-sm text-ink-600">Cargando sucursales…</p>}

      {branches !== null && (
        <section className="mb-10">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-sm font-medium text-ink-600">
              Sucursales ({branchPage.total}
              {branchPage.query ? ` de ${branches.length}` : ''})
            </h2>
            {branches.length > 8 && (
              <input
                type="search"
                value={branchPage.query}
                onChange={(e) => branchPage.onQueryChange(e.target.value)}
                placeholder="Buscar sucursal…"
                className={searchInputClass}
              />
            )}
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {branchPage.shown.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/book?branchId=${b.id}`}
                  className="flex h-full items-center justify-between rounded-lg border border-line bg-surface p-3 transition-colors hover:border-pine"
                >
                  <span>
                    <p className="font-medium text-ink">{b.name}</p>
                    <p className="text-sm text-ink-600">{b.timezone}</p>
                  </span>
                  <span className="text-sm font-medium text-pine">Reservar</span>
                </Link>
              </li>
            ))}
          </ul>
          {branchPage.remaining > 0 && (
            <button
              type="button"
              onClick={branchPage.showMore}
              className="mt-3 w-full rounded-md border border-line py-2 text-sm font-medium text-ink-600 hover:bg-surface"
            >
              Ver más ({branchPage.remaining} restantes)
            </button>
          )}
          {branches.length === 0 && (
            <p className="text-sm text-ink-600">
              Sin sucursales todavía para este tenant.
            </p>
          )}
        </section>
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-sm font-medium text-ink-600">
            Reservas{bookings !== null ? ` (${bookingPage.total})` : ''}
          </h2>
          {bookings !== null && bookings.length > 8 && (
            <input
              type="search"
              value={bookingPage.query}
              onChange={(e) => bookingPage.onQueryChange(e.target.value)}
              placeholder="Buscar reserva…"
              className={searchInputClass}
            />
          )}
        </div>

        {bookingsError && (
          <p className="rounded bg-rust-bg px-3 py-2 text-sm text-rust-dark">
            Error consultando reservas: {bookingsError}
          </p>
        )}

        {bookings === null && !bookingsError && (
          <p className="text-sm text-ink-600">Cargando reservas…</p>
        )}

        {bookings !== null && bookings.length === 0 && !bookingsError && (
          <p className="text-sm text-ink-600">
            Sin reservas todavía —{' '}
            <Link href="/book" className="font-medium text-pine underline underline-offset-2">
              creá la primera
            </Link>
            .
          </p>
        )}

        {bookings !== null && bookings.length > 0 && (
          <>
            <ul className="divide-y divide-line rounded-lg border border-line">
              {bookingPage.shown.map((b) => (
                <li
                  key={b.id}
                  className="flex flex-col gap-2 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium text-ink">{b.service?.name ?? b.serviceId}</p>
                    <p className="text-ink-600">
                      {b.branch?.name ?? b.branchId} · {b.staff?.user.email ?? b.staffId}
                    </p>
                    <p className="text-ink-600">{new Date(b.startTime).toLocaleString()}</p>
                  </div>

                  <div className="flex shrink-0 flex-col items-start gap-1.5 sm:items-end">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[b.status]}`}
                    >
                      {b.status}
                    </span>

                    {canOperate && b.status === 'PENDING' && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleBookingAction(b.id, 'confirm')}
                          disabled={actioningId !== null}
                          className={`${actionButtonClass} border-pine text-pine hover:bg-pine-bg`}
                        >
                          {actioningId === b.id ? '…' : 'Confirmar'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleBookingAction(b.id, 'cancel')}
                          disabled={actioningId !== null}
                          className={`${actionButtonClass} border-rust text-rust hover:bg-rust-bg`}
                        >
                          {actioningId === b.id ? '…' : 'Cancelar'}
                        </button>
                      </div>
                    )}

                    {rowError?.id === b.id && (
                      <p className="max-w-[16rem] text-right text-xs text-rust-dark">
                        {rowError.message}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {bookingPage.remaining > 0 && (
              <button
                type="button"
                onClick={bookingPage.showMore}
                className="mt-3 w-full rounded-md border border-line py-2 text-sm font-medium text-ink-600 hover:bg-surface"
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
