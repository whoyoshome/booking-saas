import { BadRequestException } from '@nestjs/common';
import {
  parseTimeOfDay,
  formatTimeOfDay,
  rangesOverlap,
  intersectTimeRanges,
  parseCalendarDate,
  formatCalendarDate,
} from './time.util';

describe('time.util', () => {
  describe('parseTimeOfDay / formatTimeOfDay', () => {
    it('round-trips a valid HH:mm string', () => {
      expect(formatTimeOfDay(parseTimeOfDay('09:30'))).toBe('09:30');
      expect(formatTimeOfDay(parseTimeOfDay('00:00'))).toBe('00:00');
      expect(formatTimeOfDay(parseTimeOfDay('23:59'))).toBe('23:59');
    });

    it('rejects malformed input', () => {
      expect(() => parseTimeOfDay('9:30')).toThrow(BadRequestException);
      expect(() => parseTimeOfDay('25:00')).toThrow(BadRequestException);
      expect(() => parseTimeOfDay('12:60')).toThrow(BadRequestException);
      expect(() => parseTimeOfDay('not-a-time')).toThrow(BadRequestException);
    });
  });

  describe('rangesOverlap', () => {
    it('detects a genuine overlap', () => {
      expect(
        rangesOverlap(
          parseTimeOfDay('09:00'),
          parseTimeOfDay('10:00'),
          parseTimeOfDay('09:30'),
          parseTimeOfDay('10:30'),
        ),
      ).toBe(true);
    });

    it('treats back-to-back ranges as NOT overlapping — [start, end) semantics', () => {
      // This is exactly the boundary case StaffSchedulesService relies on
      // to allow a morning block ending at 12:00 and an afternoon block
      // starting at 12:00 without falsely rejecting them as overlapping.
      expect(
        rangesOverlap(
          parseTimeOfDay('09:00'),
          parseTimeOfDay('12:00'),
          parseTimeOfDay('12:00'),
          parseTimeOfDay('17:00'),
        ),
      ).toBe(false);
    });

    it('detects no overlap when ranges are far apart', () => {
      expect(
        rangesOverlap(
          parseTimeOfDay('09:00'),
          parseTimeOfDay('10:00'),
          parseTimeOfDay('14:00'),
          parseTimeOfDay('15:00'),
        ),
      ).toBe(false);
    });
  });

  describe('intersectTimeRanges', () => {
    it('returns the narrower overlapping window (staff ∩ branch)', () => {
      const result = intersectTimeRanges(
        parseTimeOfDay('09:00'),
        parseTimeOfDay('17:00'),
        parseTimeOfDay('10:00'),
        parseTimeOfDay('16:00'),
      );
      expect(result).not.toBeNull();
      expect(formatTimeOfDay(result!.start)).toBe('10:00');
      expect(formatTimeOfDay(result!.end)).toBe('16:00');
    });

    it('returns null when the ranges do not overlap at all', () => {
      const result = intersectTimeRanges(
        parseTimeOfDay('09:00'),
        parseTimeOfDay('10:00'),
        parseTimeOfDay('14:00'),
        parseTimeOfDay('16:00'),
      );
      expect(result).toBeNull();
    });

    it('returns null for back-to-back ranges (zero-width intersection is not a valid window)', () => {
      const result = intersectTimeRanges(
        parseTimeOfDay('09:00'),
        parseTimeOfDay('12:00'),
        parseTimeOfDay('12:00'),
        parseTimeOfDay('17:00'),
      );
      expect(result).toBeNull();
    });
  });

  describe('parseCalendarDate / formatCalendarDate', () => {
    it('round-trips a valid date, anchored to UTC midnight', () => {
      const parsed = parseCalendarDate('2026-09-14');
      expect(parsed.toISOString()).toBe('2026-09-14T00:00:00.000Z');
      expect(formatCalendarDate(parsed)).toBe('2026-09-14');
    });

    it('rejects a full ISO datetime with an offset — regression test for the Fase 5 fix', () => {
      // Before the fix, @IsDateString() let this slip past the DTO layer;
      // parseCalendarDate is the second line of defense and must reject
      // it outright, not silently truncate to the wrong calendar day.
      expect(() => parseCalendarDate('2026-12-25T23:00:00-05:00')).toThrow(
        BadRequestException,
      );
    });

    it('rejects malformed input', () => {
      expect(() => parseCalendarDate('09-14-2026')).toThrow(BadRequestException);
      expect(() => parseCalendarDate('2026-9-14')).toThrow(BadRequestException);
    });
  });
});
