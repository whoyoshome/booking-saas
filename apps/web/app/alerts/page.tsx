'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../lib/auth-context';
import { apiFetch } from '../../lib/api-client';
import { canOperateRole } from '../../lib/roles';
import { useNow } from '../../lib/use-now';
import { buildDemoBookings } from '../../lib/demo-alerts';
import {
  filterByStatus,
  sortByUrgency,
  summarize,
  type StatusFilter as StatusFilterValue,
} from '../../lib/alerts';
import type { Booking } from '../../lib/types';
import { Header } from '../../components/Header';
import { usePagedList } from '../../components/use-paged-list';
import { KpiCard } from '../../components/alerts/KpiCard';
import { StatusFilter } from '../../components/alerts/StatusFilter';
import { AlertRow } from '../../components/alerts/AlertRow';
import { STATUS_LABEL } from '../../components/status-style';

// Module-level so its identity is stable across renders (usePagedList
// memoizes on it).
function matchBooking(b: Booking, q: string) {
  return `${b.service?.name ?? ''} ${b.branch?.name ?? ''} ${STATUS_LABEL[b.status]} ${b.client?.email ?? ''} ${b.staff?.user.email ?? ''}`
    .toLowerCase()
    .includes(q);
}

const REFRESH_MS = 30_000;

function AlertsView({ isDemo }: { isDemo: boolean }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const router = useRouter();
  const operator = canOperateRole(user?.role);

  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [filter, setFilter] = useState<StatusFilterValue>('ALL');

  // Real mode: `now` ticks so countdowns and priorities keep moving. Demo
  // mode: the fixtures and `now` are frozen at the same instant, so the demo
  // always looks the way it was designed instead of drifting into "expired".
  const liveNow = useNow(REFRESH_MS, !isDemo);
  const demo = useMemo(() => {
    const at = new Date();
    return { now: at, bookings: buildDemoBookings(at) };
  }, []);

  const data = isDemo ? demo.bookings : bookings;
  const now = isDemo ? demo.now : liveNow;

  const summary = useMemo(() => summarize(data ?? [], now), [data, now]);
  const visible = useMemo(
    () => sortByUrgency(filterByStatus(data ?? [], filter), now),
    [data, filter, now],
  );
  const page = usePagedList(visible, matchBooking);

  const load = useCallback(async () => {
    setFetching(true);
    setError(null);
    try {
      const res = await apiFetch('/bookings');
      if (!res.ok) throw new Error(`GET /bookings -> ${res.status}`);
      setBookings((await res.json()) as Booking[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the list.');
    } finally {
      setFetching(false);
    }
  }, []);

  // Unauthenticated -> login; a role that can't operate (CLIENT, SUPER_ADMIN)
  // -> dashboard. Same criterion as the dashboard's own `canOperate`.
  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) router.replace('/login');
    else if (!operator) router.replace('/dashboard');
  }, [isLoading, isAuthenticated, operator, router]);

  // Never fetch for a role that is about to be redirected, nor in demo mode.
  useEffect(() => {
    if (isLoading || !isAuthenticated || !operator || isDemo) return;
    load();
  }, [isLoading, isAuthenticated, operator, isDemo, load]);

  if (isLoading || !isAuthenticated || !operator) {
    return <main className="p-8 text-sm text-ink-600">Loading…</main>;
  }

  const counts: Record<StatusFilterValue, number> = { ALL: summary.total, ...summary.byStatus };
  const { needsAction } = summary;
  const waitingForData = !isDemo && bookings === null && !error;

  const sourceLink = (active: boolean) =>
    `rounded px-3 py-1 ${active ? 'bg-pine text-white' : 'text-ink-600 hover:text-ink'}`;

  return (
    <main className="mx-auto max-w-5xl p-8">
      <Header />

      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">Alerts center</h1>
          <p className="mt-0.5 text-sm text-ink-600">
            {data === null
              ? 'Bookings sorted by urgency.'
              : needsAction === 0
                ? 'Nothing needs action.'
                : `${needsAction} ${needsAction === 1 ? 'booking needs' : 'bookings need'} action.`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <nav
            aria-label="Data source"
            className="flex rounded-md border border-line bg-surface p-0.5 text-xs font-medium"
          >
            <Link
              href="/alerts"
              replace
              aria-current={!isDemo ? 'page' : undefined}
              className={sourceLink(!isDemo)}
            >
              Live data
            </Link>
            <Link
              href="/alerts?demo=1"
              replace
              aria-current={isDemo ? 'page' : undefined}
              className={sourceLink(isDemo)}
            >
              Demo
            </Link>
          </nav>
          {!isDemo && (
            <button
              type="button"
              onClick={load}
              disabled={fetching}
              className="rounded-md border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-600 transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              {fetching ? 'Refreshing…' : 'Refresh'}
            </button>
          )}
        </div>
      </div>

      {isDemo && (
        <p
          role="status"
          className="mb-6 rounded-lg border border-gold bg-gold-bg px-3 py-2 text-sm font-medium text-ink"
        >
          Demo data: these bookings are fictional and do not come from the API. Counts and
          priorities use the same rules as live data.
        </p>
      )}

      {!isDemo && error && (
        <div
          role="alert"
          className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded bg-rust-bg px-3 py-2 text-sm text-rust-dark"
        >
          <span>Could not load bookings: {error}</span>
          <button
            type="button"
            onClick={load}
            disabled={fetching}
            className="rounded border border-rust px-2 py-1 text-xs font-medium text-rust transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      )}

      {waitingForData && <p className="text-sm text-ink-600">Loading bookings…</p>}

      {data !== null && (
        <>
          <ul aria-label="Summary" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard
              label="Critical"
              value={summary.byPriority.CRITICAL}
              priority="CRITICAL"
              emphasized={summary.byPriority.CRITICAL > 0}
            />
            <KpiCard
              label="High"
              value={summary.byPriority.HIGH}
              priority="HIGH"
              emphasized={summary.byPriority.HIGH > 0}
            />
            <KpiCard
              label="Upcoming confirmed"
              value={summary.byPriority.NORMAL}
              priority="NORMAL"
            />
            <KpiCard label="Closed" value={summary.byPriority.CLOSED} priority="CLOSED" />
          </ul>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <StatusFilter value={filter} onChange={setFilter} counts={counts} />
            {data.length > 8 && (
              <input
                type="search"
                value={page.query}
                onChange={(e) => page.onQueryChange(e.target.value)}
                placeholder="Search bookings…"
                aria-label="Search bookings"
                className="w-full max-w-xs rounded-md border border-line bg-surface px-3 py-1.5 text-sm placeholder:text-ink-400 focus-visible:border-pine"
              />
            )}
          </div>

          {data.length === 0 && (
            <p className="text-sm text-ink-600">No bookings yet for this business.</p>
          )}

          {data.length > 0 && visible.length === 0 && (
            <p className="text-sm text-ink-600">
              No bookings with status {filter === 'ALL' ? 'All' : STATUS_LABEL[filter]}.
            </p>
          )}

          {visible.length > 0 && page.total === 0 && (
            <p className="text-sm text-ink-600">No bookings match “{page.query}”.</p>
          )}

          {page.shown.length > 0 && (
            <ul aria-label="Bookings by urgency" className="grid gap-2 lg:grid-cols-2">
              {page.shown.map((b) => (
                <AlertRow key={b.id} booking={b} now={now} showManageLink={!isDemo} />
              ))}
            </ul>
          )}

          {page.remaining > 0 && (
            <button
              type="button"
              onClick={page.showMore}
              className="mt-3 w-full rounded-md border border-line py-2 text-sm font-medium text-ink-600 hover:bg-surface"
            >
              Show more ({page.remaining} left)
            </button>
          )}
        </>
      )}
    </main>
  );
}

// Keyed by data source: switching between "Live data" and "Demo" remounts
// the view, so the status filter, the search box, the paging and the fetched
// list all start clean. Otherwise a filter chosen on one dataset would carry
// over to the other and could hide every row.
function AlertsRoute() {
  const isDemo = useSearchParams().get('demo') === '1';
  return <AlertsView key={isDemo ? 'demo' : 'live'} isDemo={isDemo} />;
}

// useSearchParams needs a Suspense boundary in the App Router, same as /book.
export default function AlertsPage() {
  return (
    <Suspense fallback={<main className="p-8 text-sm text-ink-600">Loading…</main>}>
      <AlertsRoute />
    </Suspense>
  );
}
