// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { makeBooking, minutesFrom, NOW, pending } from '../test/helpers';
import {
  BOOKING_STATUSES,
  CRITICAL_EXPIRY_MINUTES,
  CRITICAL_START_WITHIN_MINUTES,
  PENDING_TTL_MINUTES,
  filterByStatus,
  getPriority,
  minutesUntilAction,
  minutesUntilExpiry,
  sortByUrgency,
  summarize,
} from './alerts';

describe('getPriority — PENDING', () => {
  it.each([
    // [expiresInMin, startsInMin, expected, why]
    [2.99, 5000, 'CRITICAL', 'expires just under the threshold'],
    [3, 5000, 'HIGH', 'exactly at the expiry threshold is still HIGH'],
    [9, 5000, 'HIGH', 'plenty of time on both clocks'],
    [9, 59.9, 'CRITICAL', 'starts just under an hour'],
    [9, 60, 'HIGH', 'starts in exactly an hour is still HIGH'],
    [9, -30, 'CRITICAL', 'already started'],
    [-2, 5000, 'CRITICAL', 'hold already expired, cron has not swept it yet'],
  ] as const)('expires in %s min, starts in %s min -> %s (%s)', (expiresIn, startsIn, expected, _why) => {
    expect(getPriority(pending(expiresIn, startsIn), NOW)).toBe(expected);
  });

  it('uses the named thresholds, not magic numbers', () => {
    expect(CRITICAL_EXPIRY_MINUTES).toBe(3);
    expect(CRITICAL_START_WITHIN_MINUTES).toBe(60);
  });

  it('falls back to HIGH (never throws) when the dates do not parse', () => {
    const booking = pending(9, 5000, { createdAt: 'nope', startTime: 'nope' });
    expect(getPriority(booking, NOW)).toBe('HIGH');
  });
});

describe('getPriority — CONFIRMED', () => {
  const at = (startOffset: number, endOffset: number) =>
    makeBooking({
      status: 'CONFIRMED',
      startTime: minutesFrom(startOffset),
      endTime: minutesFrom(endOffset),
    });

  it('is NORMAL while upcoming', () => {
    expect(getPriority(at(60, 90), NOW)).toBe('NORMAL');
  });

  it('is NORMAL while in progress (started, not ended)', () => {
    expect(getPriority(at(-30, 0.1), NOW)).toBe('NORMAL');
  });

  it('is CLOSED when it ends exactly now', () => {
    expect(getPriority(at(-30, 0), NOW)).toBe('CLOSED');
  });

  it('is CLOSED once it has ended — the backend never moves it to COMPLETED', () => {
    expect(getPriority(at(-60, -0.1), NOW)).toBe('CLOSED');
    expect(getPriority(at(-3 * 24 * 60, -3 * 24 * 60 + 30), NOW)).toBe('CLOSED');
  });

  it('falls back to NORMAL (never throws) when the end date does not parse', () => {
    expect(getPriority(makeBooking({ endTime: 'nope' }), NOW)).toBe('NORMAL');
  });
});

describe('getPriority — other statuses', () => {
  it.each(['CANCELLED', 'COMPLETED', 'NO_SHOW'] as const)('%s is CLOSED, even in the future', (status) => {
    expect(getPriority(makeBooking({ status }), NOW)).toBe('CLOSED');
  });
});

describe('minutesUntilExpiry', () => {
  it('counts down from createdAt + TTL', () => {
    const booking = makeBooking({ status: 'PENDING', createdAt: minutesFrom(-4) });
    expect(minutesUntilExpiry(booking, NOW)).toBeCloseTo(PENDING_TTL_MINUTES - 4, 9);
  });

  it('goes negative once the hold has expired', () => {
    const booking = makeBooking({ status: 'PENDING', createdAt: minutesFrom(-12) });
    expect(minutesUntilExpiry(booking, NOW)).toBeCloseTo(-2, 9);
  });

  it.each(['CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'] as const)('is null for %s', (status) => {
    expect(minutesUntilExpiry(makeBooking({ status }), NOW)).toBeNull();
  });
});

describe('minutesUntilAction', () => {
  it('is the sooner of expiry and start', () => {
    expect(minutesUntilAction(pending(5, 40), NOW)).toBeCloseTo(5, 9);
    expect(minutesUntilAction(pending(9, 3), NOW)).toBeCloseTo(3, 9);
  });

  it('is negative when either moment has already passed', () => {
    expect(minutesUntilAction(pending(-2, 500), NOW)).toBeCloseTo(-2, 9);
    expect(minutesUntilAction(pending(9, -30), NOW)).toBeCloseTo(-30, 9);
  });

  it('uses the one date that parses when the other does not', () => {
    const booking = pending(9, 25, { createdAt: 'nope' });
    expect(minutesUntilAction(booking, NOW)).toBeCloseTo(25, 9);
  });

  it('is Infinity when neither date parses', () => {
    const booking = pending(9, 25, { createdAt: 'nope', startTime: 'nope' });
    expect(minutesUntilAction(booking, NOW)).toBe(Infinity);
  });

  it('is Infinity for anything that is not PENDING', () => {
    expect(minutesUntilAction(makeBooking({ status: 'CONFIRMED' }), NOW)).toBe(Infinity);
  });
});

describe('summarize', () => {
  it('returns zeros for an empty list', () => {
    expect(summarize([], NOW)).toEqual({
      total: 0,
      byStatus: { PENDING: 0, CONFIRMED: 0, CANCELLED: 0, COMPLETED: 0, NO_SHOW: 0 },
      byPriority: { CRITICAL: 0, HIGH: 0, NORMAL: 0, CLOSED: 0 },
      needsAction: 0,
    });
  });

  it('counts by stored status and by priority separately', () => {
    const summary = summarize(
      [
        pending(1, 500), // CRITICAL
        pending(9, 30), // CRITICAL
        pending(9, 500), // HIGH
        makeBooking(), // CONFIRMED, upcoming -> NORMAL
        makeBooking({ startTime: minutesFrom(-120), endTime: minutesFrom(-90) }), // CONFIRMED, over -> CLOSED
        makeBooking({ status: 'CANCELLED' }),
      ],
      NOW,
    );

    expect(summary.total).toBe(6);
    expect(summary.byStatus).toEqual({ PENDING: 3, CONFIRMED: 2, CANCELLED: 1, COMPLETED: 0, NO_SHOW: 0 });
    expect(summary.byPriority).toEqual({ CRITICAL: 2, HIGH: 1, NORMAL: 1, CLOSED: 2 });
    // The CONFIRMED that is over counts as CONFIRMED by status, CLOSED by priority.
    expect(summary.byStatus.CONFIRMED).not.toBe(summary.byPriority.NORMAL);
  });

  it('needsAction is CRITICAL + HIGH', () => {
    const summary = summarize([pending(1, 500), pending(9, 500), makeBooking()], NOW);
    expect(summary.needsAction).toBe(2);
  });

  it('the priority counts always add up to the total', () => {
    const list = [pending(1, 5), pending(8, 900), makeBooking(), makeBooking({ status: 'NO_SHOW' })];
    const { byPriority, total } = summarize(list, NOW);
    expect(byPriority.CRITICAL + byPriority.HIGH + byPriority.NORMAL + byPriority.CLOSED).toBe(total);
  });
});

describe('sortByUrgency', () => {
  const ids = (list: { id: string }[]) => list.map((b) => b.id);

  it('orders CRITICAL, HIGH, NORMAL, CLOSED', () => {
    const closed = makeBooking({ id: 'closed', status: 'CANCELLED' });
    const normal = makeBooking({ id: 'normal' });
    const high = pending(9, 500, { id: 'high' });
    const critical = pending(1, 500, { id: 'critical' });

    expect(ids(sortByUrgency([closed, normal, high, critical], NOW))).toEqual([
      'critical',
      'high',
      'normal',
      'closed',
    ]);
  });

  describe('within CRITICAL', () => {
    it('puts a hold expiring in 1 min above one starting in 40 min', () => {
      const startsSoon = pending(8, 40, { id: 'starts-in-40' });
      const expiresSoon = pending(1, 180, { id: 'expires-in-1' });

      expect(ids(sortByUrgency([startsSoon, expiresSoon], NOW))).toEqual(['expires-in-1', 'starts-in-40']);
    });

    it('ranks by whichever clock runs out first', () => {
      // All three are CRITICAL; what differs is which clock runs out first.
      const a = pending(2.5, 500, { id: 'a-expires-in-2.5' }); // action in 2.5
      const b = pending(9, 10, { id: 'b-starts-in-10' }); // action in min(9, 10) = 9
      const c = pending(1, 500, { id: 'c-expires-in-1' }); // action in 1

      expect(ids(sortByUrgency([a, b, c], NOW))).toEqual(['c-expires-in-1', 'a-expires-in-2.5', 'b-starts-in-10']);
    });

    it('puts what already expired or already started first', () => {
      const expired = pending(-2, 500, { id: 'expired' });
      const started = pending(9, -30, { id: 'started' });
      const soon = pending(1, 500, { id: 'soon' });

      expect(ids(sortByUrgency([soon, expired, started], NOW))).toEqual(['started', 'expired', 'soon']);
    });

    it('breaks a tie on start time, then id', () => {
      const later = pending(2, 400, { id: 'later' });
      const sooner = pending(2, 300, { id: 'sooner' });
      expect(ids(sortByUrgency([later, sooner], NOW))).toEqual(['sooner', 'later']);

      const x = pending(2, 300, { id: 'x' });
      const y = pending(2, 300, { id: 'y' });
      expect(ids(sortByUrgency([y, x], NOW))).toEqual(['x', 'y']);
    });
  });

  it('orders HIGH and NORMAL by soonest start', () => {
    const highLater = pending(9, 3000, { id: 'high-later' });
    const highSooner = pending(4, 600, { id: 'high-sooner' });
    const normalLater = makeBooking({ id: 'normal-later', startTime: minutesFrom(2000), endTime: minutesFrom(2030) });
    const normalSooner = makeBooking({ id: 'normal-sooner', startTime: minutesFrom(120), endTime: minutesFrom(150) });

    expect(ids(sortByUrgency([normalLater, highLater, normalSooner, highSooner], NOW))).toEqual([
      'high-sooner',
      'high-later',
      'normal-sooner',
      'normal-later',
    ]);
  });

  it('orders CLOSED by most recent start first', () => {
    const old = makeBooking({ id: 'old', status: 'CANCELLED', startTime: minutesFrom(-3000) });
    const recent = makeBooking({ id: 'recent', status: 'COMPLETED', startTime: minutesFrom(-60) });

    expect(ids(sortByUrgency([old, recent], NOW))).toEqual(['recent', 'old']);
  });

  it('does not let an old CONFIRMED lead the list just because its start time is oldest', () => {
    const oldConfirmed = makeBooking({
      id: 'old-confirmed',
      startTime: minutesFrom(-5 * 24 * 60),
      endTime: minutesFrom(-5 * 24 * 60 + 30),
    });
    const upcoming = makeBooking({ id: 'upcoming', startTime: minutesFrom(300), endTime: minutesFrom(330) });
    const high = pending(6, 900, { id: 'high' });

    const sorted = ids(sortByUrgency([oldConfirmed, upcoming, high], NOW));
    expect(sorted).toEqual(['high', 'upcoming', 'old-confirmed']);
  });

  it('is stable: equal bookings come out in id order whatever the input order', () => {
    const a = makeBooking({ id: 'a' });
    const b = makeBooking({ id: 'b', startTime: a.startTime, endTime: a.endTime });

    expect(ids(sortByUrgency([b, a], NOW))).toEqual(['a', 'b']);
    expect(ids(sortByUrgency([a, b], NOW))).toEqual(['a', 'b']);
  });

  it('does not mutate its input', () => {
    const input = [makeBooking({ id: 'z', status: 'CANCELLED' }), pending(1, 500, { id: 'y' })];
    const snapshot = ids(input);

    sortByUrgency(input, NOW);

    expect(ids(input)).toEqual(snapshot);
  });

  it('returns an empty list for an empty list', () => {
    expect(sortByUrgency([], NOW)).toEqual([]);
  });
});

describe('filterByStatus', () => {
  const list = [
    makeBooking({ id: 'p', status: 'PENDING' }),
    makeBooking({ id: 'c', status: 'CONFIRMED' }),
    makeBooking({ id: 'x', status: 'CANCELLED' }),
    makeBooking({ id: 'd', status: 'COMPLETED' }),
    makeBooking({ id: 'n', status: 'NO_SHOW' }),
  ];

  it('ALL returns every booking', () => {
    expect(filterByStatus(list, 'ALL')).toBe(list);
  });

  it.each(BOOKING_STATUSES)('%s keeps only that status', (status) => {
    const result = filterByStatus(list, status);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe(status);
  });

  it('filters by the stored status, so a finished CONFIRMED still matches CONFIRMED', () => {
    const finished = makeBooking({ id: 'finished', startTime: minutesFrom(-200), endTime: minutesFrom(-170) });
    expect(getPriority(finished, NOW)).toBe('CLOSED');
    expect(filterByStatus([finished], 'CONFIRMED')).toEqual([finished]);
  });
});

describe('PENDING_TTL_MINUTES', () => {
  // The constant is duplicated from the API on purpose (no config endpoint).
  // This is the guard that keeps the copy honest. It reads the API source, so
  // it only runs when the file is there (i.e. inside the monorepo checkout).
  const apiFile = fileURLToPath(
    new URL('../../api/src/bookings/bookings-cleanup.service.ts', import.meta.url),
  );

  it.skipIf(!existsSync(apiFile))('matches PENDING_TTL_MINUTES in bookings-cleanup.service.ts', () => {
    const match = /PENDING_TTL_MINUTES\s*=\s*(\d+)/.exec(readFileSync(apiFile, 'utf8'));

    expect(match).not.toBeNull();
    expect(PENDING_TTL_MINUTES).toBe(Number(match?.[1]));
  });
});
