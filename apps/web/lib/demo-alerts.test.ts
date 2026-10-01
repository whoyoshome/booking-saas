import { describe, expect, it } from 'vitest';
import { NOW } from '../test/helpers';
import { PENDING_TTL_MINUTES, getPriority, minutesUntilExpiry, summarize } from './alerts';
import { buildDemoBookings } from './demo-alerts';

describe('buildDemoBookings', () => {
  const bookings = buildDemoBookings(NOW);

  it('builds 15 bookings with unique ids', () => {
    expect(bookings).toHaveLength(15);
    expect(new Set(bookings.map((b) => b.id)).size).toBe(15);
  });

  it('covers every status', () => {
    const statuses = new Set(bookings.map((b) => b.status));
    expect([...statuses].sort()).toEqual(['CANCELLED', 'COMPLETED', 'CONFIRMED', 'NO_SHOW', 'PENDING']);
  });

  it('spreads across the priorities: 3 critical, 3 high, 3 normal, 6 closed', () => {
    const { byPriority, byStatus, needsAction } = summarize(bookings, NOW);

    expect(byPriority).toEqual({ CRITICAL: 3, HIGH: 3, NORMAL: 3, CLOSED: 6 });
    expect(byStatus).toEqual({ PENDING: 6, CONFIRMED: 4, CANCELLED: 2, COMPLETED: 2, NO_SHOW: 1 });
    expect(needsAction).toBe(6);
  });

  it('includes a CONFIRMED booking that is already over (and so CLOSED)', () => {
    const finished = bookings.filter((b) => b.status === 'CONFIRMED' && getPriority(b, NOW) === 'CLOSED');
    expect(finished).toHaveLength(1);
  });

  it('never has a PENDING hold that is already expired, or longer than the TTL', () => {
    for (const booking of bookings.filter((b) => b.status === 'PENDING')) {
      const left = minutesUntilExpiry(booking, NOW);
      expect(left).not.toBeNull();
      expect(left ?? 0).toBeGreaterThan(0);
      expect(left ?? 0).toBeLessThanOrEqual(PENDING_TTL_MINUTES);
    }
  });

  it('gives every booking the fields the UI reads', () => {
    for (const b of bookings) {
      expect(b.service?.name).toBeTruthy();
      expect(b.branch?.name).toBeTruthy();
      expect(b.staff?.user.email).toBeTruthy();
      expect(b.client?.email).toBeTruthy();
      expect(new Date(b.endTime).getTime()).toBeGreaterThan(new Date(b.startTime).getTime());
    }
  });

  it('is relative to `now`: shifting now shifts every date by the same amount', () => {
    const shiftMs = 3 * 60 * 60 * 1000;
    const later = buildDemoBookings(new Date(NOW.getTime() + shiftMs));

    later.forEach((b, i) => {
      expect(new Date(b.startTime).getTime() - new Date(bookings[i].startTime).getTime()).toBe(shiftMs);
      expect(new Date(b.createdAt).getTime() - new Date(bookings[i].createdAt).getTime()).toBe(shiftMs);
    });
    // ...which also means the same priorities come out at the shifted time.
    expect(summarize(later, new Date(NOW.getTime() + shiftMs)).byPriority).toEqual(
      summarize(bookings, NOW).byPriority,
    );
  });

  it('defaults to the current time when called without arguments', () => {
    const before = Date.now();
    const [first] = buildDemoBookings();
    const after = Date.now();

    // demo-01 starts 3 hours from "now".
    const offsetMs = new Date(first.startTime).getTime() - 3 * 60 * 60 * 1000;
    expect(offsetMs).toBeGreaterThanOrEqual(before);
    expect(offsetMs).toBeLessThanOrEqual(after);
  });
});
