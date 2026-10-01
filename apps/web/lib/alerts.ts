import type { Booking } from './types';

// Alert priority for /alerts, derived from GET /bookings fields; the API has
// no priority concept. `now` is always a parameter so every rule is testable.

/**
 * How long a PENDING booking holds its slot before the API cancels it.
 * Mirrors PENDING_TTL_MINUTES in apps/api/src/bookings/bookings-cleanup.service.ts;
 * alerts.test.ts fails if the two diverge.
 */
export const PENDING_TTL_MINUTES = 10;

/** A PENDING booking with less than this left before expiry is CRITICAL. */
export const CRITICAL_EXPIRY_MINUTES = 3;

/** A PENDING booking starting in less than this is CRITICAL. */
export const CRITICAL_START_WITHIN_MINUTES = 60;

export type BookingStatus = Booking['status'];
export type Priority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'CLOSED';
export type StatusFilter = BookingStatus | 'ALL';

export const BOOKING_STATUSES: readonly BookingStatus[] = [
  'PENDING',
  'CONFIRMED',
  'CANCELLED',
  'COMPLETED',
  'NO_SHOW',
];

export const PRIORITIES: readonly Priority[] = ['CRITICAL', 'HIGH', 'NORMAL', 'CLOSED'];

const PRIORITY_RANK: Record<Priority, number> = {
  CRITICAL: 0,
  HIGH: 1,
  NORMAL: 2,
  CLOSED: 3,
};

const MS_PER_MINUTE = 60_000;

function minutesBetween(from: Date, toIso: string): number {
  return (new Date(toIso).getTime() - from.getTime()) / MS_PER_MINUTE;
}

/**
 * Minutes left before a PENDING booking is auto-cancelled, or null for any
 * other status (only PENDING holds expire). Negative means the TTL already
 * passed and the next cron sweep (every minute) will cancel it.
 */
export function minutesUntilExpiry(booking: Booking, now: Date): number | null {
  if (booking.status !== 'PENDING') return null;
  return minutesBetween(now, booking.createdAt) + PENDING_TTL_MINUTES;
}

/**
 * Rules:
 * - PENDING, expires in < CRITICAL_EXPIRY_MINUTES, or starts in
 *   < CRITICAL_START_WITHIN_MINUTES (including already started) -> CRITICAL
 * - any other PENDING                                             -> HIGH
 * - CONFIRMED whose endTime is still in the future (upcoming or in
 *   progress)                                                     -> NORMAL
 * - CONFIRMED whose endTime has already passed                    -> CLOSED
 * - CANCELLED / COMPLETED / NO_SHOW                               -> CLOSED
 *
 * Why a past CONFIRMED is CLOSED: the backend never moves a booking to
 * COMPLETED or NO_SHOW (no job does it), so with real data old CONFIRMED
 * rows would otherwise stay NORMAL forever — and, having the oldest
 * startTime, sortByUrgency would put them at the very top of the open
 * items. Nothing is left to act on once the appointment is over, so it
 * is treated as closed regardless of the stored status.
 *
 * Boundaries are strict: exactly 3 minutes left, or starting in exactly 60
 * minutes, is still HIGH. A CONFIRMED booking ending exactly at `now` has
 * ended, so it is CLOSED. An unparseable date yields NaN, every comparison
 * with NaN is false, so a PENDING falls back to HIGH and a CONFIRMED to
 * NORMAL rather than throwing.
 */
export function getPriority(booking: Booking, now: Date): Priority {
  switch (booking.status) {
    case 'PENDING': {
      const expiresIn = minutesUntilExpiry(booking, now);
      const startsIn = minutesBetween(now, booking.startTime);
      if (
        (expiresIn !== null && expiresIn < CRITICAL_EXPIRY_MINUTES) ||
        startsIn < CRITICAL_START_WITHIN_MINUTES
      ) {
        return 'CRITICAL';
      }
      return 'HIGH';
    }
    case 'CONFIRMED':
      return minutesBetween(now, booking.endTime) <= 0 ? 'CLOSED' : 'NORMAL';
    default:
      return 'CLOSED';
  }
}

export interface AlertSummary {
  total: number;
  byStatus: Record<BookingStatus, number>;
  byPriority: Record<Priority, number>;
  /** CRITICAL + HIGH: everything an admin still has to act on. */
  needsAction: number;
}

export function summarize(bookings: Booking[], now: Date): AlertSummary {
  const byStatus: Record<BookingStatus, number> = {
    PENDING: 0,
    CONFIRMED: 0,
    CANCELLED: 0,
    COMPLETED: 0,
    NO_SHOW: 0,
  };
  const byPriority: Record<Priority, number> = {
    CRITICAL: 0,
    HIGH: 0,
    NORMAL: 0,
    CLOSED: 0,
  };

  for (const b of bookings) {
    byStatus[b.status] += 1;
    byPriority[getPriority(b, now)] += 1;
  }

  return {
    total: bookings.length,
    byStatus,
    byPriority,
    needsAction: byPriority.CRITICAL + byPriority.HIGH,
  };
}

/**
 * Minutes until this PENDING booking needs a decision: the sooner of "its
 * hold expires" and "it starts". Negative means one of the two already
 * happened. Infinity for any other status, or if neither date parses.
 */
export function minutesUntilAction(booking: Booking, now: Date): number {
  if (booking.status !== 'PENDING') return Infinity;

  const candidates = [
    minutesUntilExpiry(booking, now),
    minutesBetween(now, booking.startTime),
  ].filter((m): m is number => m !== null && Number.isFinite(m));

  return candidates.length === 0 ? Infinity : Math.min(...candidates);
}

/**
 * Most urgent first.
 *
 * Within CRITICAL: by minutesUntilAction, soonest first. A hold that
 * expires in 1 minute goes above a booking that starts in 40, because the
 * hold cancels itself first and the slot is lost.
 *
 * Within the other priorities: open items (everything but CLOSED) by
 * soonest startTime; CLOSED by most recent startTime first.
 *
 * Ties break on startTime, then id, so the order is stable. Does not
 * mutate the input.
 */
export function sortByUrgency(bookings: Booking[], now: Date): Booking[] {
  return bookings
    .map((booking) => {
      const priority = getPriority(booking, now);
      return {
        booking,
        priority,
        action: priority === 'CRITICAL' ? minutesUntilAction(booking, now) : 0,
      };
    })
    .sort((a, b) => {
      const byRank = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      if (byRank !== 0) return byRank;

      // Infinity - Infinity is NaN, hence the guard.
      const byAction = a.action - b.action;
      if (byAction !== 0 && !Number.isNaN(byAction)) return byAction;

      const aStart = new Date(a.booking.startTime).getTime();
      const bStart = new Date(b.booking.startTime).getTime();
      const byStart = a.priority === 'CLOSED' ? bStart - aStart : aStart - bStart;
      if (byStart !== 0 && !Number.isNaN(byStart)) return byStart;

      return a.booking.id.localeCompare(b.booking.id);
    })
    .map((entry) => entry.booking);
}

export function filterByStatus(bookings: Booking[], filter: StatusFilter): Booking[] {
  if (filter === 'ALL') return bookings;
  return bookings.filter((b) => b.status === filter);
}
