import { PENDING_TTL_MINUTES } from '../lib/alerts';
import type { Booking } from '../lib/types';

/** A fixed instant, so time-dependent rules are deterministic. */
export const NOW = new Date('2026-09-30T12:00:00.000Z');

const MS_PER_MINUTE = 60_000;

/** ISO string `offsetMin` minutes from `base` (negative = in the past). */
export function minutesFrom(offsetMin: number, base: Date = NOW): string {
  return new Date(base.getTime() + offsetMin * MS_PER_MINUTE).toISOString();
}

let sequence = 0;

/** A CONFIRMED booking starting tomorrow unless overridden. */
export function makeBooking(overrides: Partial<Booking> = {}, base: Date = NOW): Booking {
  sequence += 1;
  return {
    id: `b-${sequence}`,
    staffId: 'staff-1',
    serviceId: 'service-1',
    branchId: 'branch-1',
    clientId: 'client-1',
    startTime: minutesFrom(24 * 60, base),
    endTime: minutesFrom(24 * 60 + 30, base),
    status: 'CONFIRMED',
    createdAt: minutesFrom(-24 * 60, base),
    branch: { name: 'Downtown Branch' },
    service: { name: 'Haircut' },
    staff: { user: { email: 'ana@tenant-a.dev' } },
    client: { email: 'cliente@example.com' },
    ...overrides,
  };
}

/**
 * A PENDING booking described by what matters to the rules: minutes left
 * before its hold expires, and minutes until it starts.
 */
export function pending(
  expiresInMin: number,
  startsInMin: number,
  overrides: Partial<Booking> = {},
  base: Date = NOW,
): Booking {
  return makeBooking(
    {
      status: 'PENDING',
      createdAt: minutesFrom(expiresInMin - PENDING_TTL_MINUTES, base),
      startTime: minutesFrom(startsInMin, base),
      endTime: minutesFrom(startsInMin + 30, base),
      ...overrides,
    },
    base,
  );
}
