import { BadRequestException } from '@nestjs/common';

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Converts an "HH:mm" (24h) string into the fixed-reference-date Date
 * object Prisma expects for a @db.Time column. 1970-01-01T...Z is an
 * arbitrary, always-the-same reference date — only the hour/minute
 * components are ever meaningful or read back. Always built in UTC so the
 * server's own local timezone never leaks into stored values.
 */
export function parseTimeOfDay(value: string): Date {
  if (!TIME_REGEX.test(value)) {
    throw new BadRequestException(
      `Invalid time "${value}" — expected 24h HH:mm format.`,
    );
  }
  return new Date(`1970-01-01T${value}:00.000Z`);
}

/** Inverse of parseTimeOfDay — reads a Prisma @db.Time value back as "HH:mm". */
export function formatTimeOfDay(value: Date): string {
  const hours = value.getUTCHours().toString().padStart(2, '0');
  const minutes = value.getUTCMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Two [start, end) ranges overlap iff each starts before the other ends.
 * Safe to compare via getTime() here because both values share the exact
 * same reference date (1970-01-01) — the comparison behaves like a plain
 * time-of-day comparison.
 */
export function rangesOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/**
 * Returns the overlapping sub-range of two [start, end) time-of-day
 * ranges, or null if they don't overlap at all. GAP FIX (Fase 9/10): this
 * was missing from this module entirely — AvailabilityService had its own
 * private, duplicate implementation (intersectBlocks) instead of using a
 * shared, independently-unit-tested function. Now it delegates here.
 */
export function intersectTimeRanges(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): { start: Date; end: Date } | null {
  const start = aStart.getTime() > bStart.getTime() ? aStart : bStart;
  const end = aEnd.getTime() < bEnd.getTime() ? aEnd : bEnd;
  if (start.getTime() >= end.getTime()) return null;
  return { start, end };
}

const CALENDAR_DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * FIX — parses a calendar date ("YYYY-MM-DD", no time/offset component
 * allowed) by explicitly constructing UTC midnight via Date.UTC(), instead
 * of `new Date(value)`. A bare `new Date("2026-12-25")` already parses as
 * UTC midnight per the ECMAScript spec, BUT `@IsDateString()` (used
 * before this fix) accepts the full ISO-8601 grammar, including a
 * datetime with an explicit offset (e.g. "2026-12-25T23:00:00-05:00") —
 * which does NOT land on UTC midnight of the intended calendar day. This
 * function is paired with a strict "date-only" validator on the DTO
 * (@Matches, not @IsDateString) so a datetime string is rejected at
 * validation time, and even if one slipped through, only the Y/M/D
 * components are ever read here — never a time-of-day or offset.
 */
export function parseCalendarDate(value: string): Date {
  const match = CALENDAR_DATE_REGEX.exec(value);
  if (!match) {
    throw new BadRequestException(
      `Invalid date "${value}" — expected YYYY-MM-DD format.`,
    );
  }
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

/** Inverse of parseCalendarDate — reads a Prisma @db.Date value back as "YYYY-MM-DD". */
export function formatCalendarDate(value: Date): string {
  const year = value.getUTCFullYear().toString().padStart(4, '0');
  const month = (value.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = value.getUTCDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}
