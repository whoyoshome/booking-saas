/**
 * Calendar dates for e2e specs, always relative to the real clock: the API
 * never offers or accepts a slot that has already started, so a hardcoded
 * date stops working the day it passes.
 */

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * yyyy-mm-dd of a Monday at least 7 days from now (UTC calendar), plus
 * `weeksLater` weeks. Every slot on it is in the future in any branch time
 * zone, and different `weeksLater` values never collide.
 */
export function futureMonday(weeksLater = 0): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 7);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCDate(d.getUTCDate() + 7 * weeksLater);
  return isoDate(d);
}

/** Today's yyyy-mm-dd in UTC, plus `days` (negative for the past). */
export function utcDate(days = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

/** ISO-8601 day of week (1 = Monday … 7 = Sunday) of today in UTC, as StaffSchedule stores it. */
export function utcIsoDayOfWeek(): number {
  const day = new Date().getUTCDay();
  return day === 0 ? 7 : day;
}
