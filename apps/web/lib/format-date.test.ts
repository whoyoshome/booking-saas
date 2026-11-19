import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatTime, formatTimeRange } from './format-date';

// 2026-11-19 18:00 UTC is 1:00 PM in Bogotá (UTC-5) and 12:00 PM in Mexico City (UTC-6).
const INSTANT = '2026-11-19T18:00:00.000Z';

describe('format-date', () => {
  it('formats a date as short weekday, month and day', () => {
    expect(formatDate(INSTANT, 'America/Bogota')).toBe('Thu, Nov 19');
  });

  it('formats a time on a 12-hour clock with a plain space before AM/PM', () => {
    expect(formatTime(INSTANT, 'America/Bogota')).toBe('1:00 PM');
    expect(formatTime('2026-11-19T14:05:00.000Z', 'America/Bogota')).toBe('9:05 AM');
  });

  it('joins date and time with a middle dot', () => {
    expect(formatDateTime(INSTANT, 'America/Bogota')).toBe('Thu, Nov 19 · 1:00 PM');
  });

  it('uses the time zone it is given', () => {
    expect(formatDateTime(INSTANT, 'America/Mexico_City')).toBe('Thu, Nov 19 · 12:00 PM');
    // Late evening in Bogotá is already the next day in UTC.
    expect(formatDate('2026-11-20T03:30:00.000Z', 'America/Bogota')).toBe('Thu, Nov 19');
  });

  it('formats a time range', () => {
    expect(formatTimeRange(INSTANT, '2026-11-19T18:30:00.000Z', 'America/Bogota')).toBe('1:00 PM – 1:30 PM');
  });

  it('never shows a raw ISO date', () => {
    expect(formatDateTime(INSTANT, 'UTC')).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('shows a dash for an unparseable date instead of throwing', () => {
    expect(formatDate('nope')).toBe('—');
    expect(formatTime('nope')).toBe('—');
    expect(formatDateTime('nope')).toBe('—');
  });

  it('accepts Date objects', () => {
    expect(formatTime(new Date(INSTANT), 'UTC')).toBe('6:00 PM');
  });
});
