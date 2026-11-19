import Link from 'next/link';
import { getPriority, minutesUntilExpiry } from '../../lib/alerts';
import { describeExpiry, describeStart, minutesFromNow } from '../../lib/format-time';
import type { Booking } from '../../lib/types';
import { PriorityBadge } from './PriorityBadge';
import { PRIORITY_ROW } from './priority-style';

interface AlertRowProps {
  booking: Booking;
  now: Date;
  /** Link PENDING rows to the dashboard, where they can be accepted/rejected. */
  showManageLink?: boolean;
}

const START_FORMAT: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
};

export function AlertRow({ booking, now, showManageLink = false }: AlertRowProps) {
  const priority = getPriority(booking, now);
  const expiresIn = minutesUntilExpiry(booking, now);

  // CONFIRMED but already over: the stored status says CONFIRMED (nothing
  // ever moves it to COMPLETED), the priority says CLOSED. Say both, so it
  // doesn't look like a contradiction when it shows up under the CONFIRMED chip.
  const finished = booking.status === 'CONFIRMED' && priority === 'CLOSED';
  const statusText = finished ? `${booking.status} · ended` : booking.status;

  const startHint =
    priority === 'CLOSED' ? '' : describeStart(minutesFromNow(booking.startTime, now));
  const hintClass =
    priority === 'CRITICAL' ? 'text-xs font-medium text-rust-dark' : 'text-xs text-ink-600';

  return (
    <li
      className={`flex flex-col gap-2 rounded-lg border border-l-4 border-line p-3 text-sm sm:flex-row sm:items-start sm:justify-between ${PRIORITY_ROW[priority]}`}
    >
      <div className="min-w-0">
        <p className="font-medium text-ink">{booking.service?.name ?? booking.serviceId}</p>
        <p className="text-ink-600">
          {booking.branch?.name ?? booking.branchId} · {booking.staff?.user.email ?? booking.staffId}
        </p>
        {booking.client?.email && <p className="text-ink-600">Client: {booking.client.email}</p>}
        <p className="text-ink-600">
          {new Date(booking.startTime).toLocaleString('es', START_FORMAT)}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
        <PriorityBadge priority={priority} />
        <span className="text-xs font-medium text-ink-600">{statusText}</span>
        {expiresIn !== null && <span className={hintClass}>{describeExpiry(expiresIn)}</span>}
        {startHint && <span className={hintClass}>{startHint}</span>}
        {showManageLink && booking.status === 'PENDING' && (
          <Link
            href="/dashboard"
            className="text-xs font-medium text-pine underline underline-offset-2"
          >
            Resolve on the dashboard
          </Link>
        )}
      </div>
    </li>
  );
}
