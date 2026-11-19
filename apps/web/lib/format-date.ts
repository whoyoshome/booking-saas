// One place for how dates and times read in the UI: en-US, short weekday
// and month, 12-hour clock — "Thu, Nov 19 · 1:00 PM". Lists, alerts and the
// booking confirmation all go through here, so no screen shows a raw ISO
// string or a locale-dependent toLocaleString().
//
// `timeZone` is optional: lists use the viewer's own zone (as before); the
// booking wizard passes the branch's IANA zone, because the slots it offers
// are wall-clock times at that branch.

const LOCALE = 'en-US';

const DATE: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };
const TIME: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };

function format(value: string | Date, options: Intl.DateTimeFormatOptions, timeZone?: string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  // Recent ICU versions put a narrow no-break space before AM/PM; a plain
  // space keeps the text identical across Node, browsers and test queries.
  return new Intl.DateTimeFormat(LOCALE, { ...options, timeZone })
    .format(date)
    .replace(/ /g, ' ');
}

/** "Thu, Nov 19" */
export function formatDate(value: string | Date, timeZone?: string): string {
  return format(value, DATE, timeZone);
}

/** "1:00 PM" */
export function formatTime(value: string | Date, timeZone?: string): string {
  return format(value, TIME, timeZone);
}

/** "Thu, Nov 19 · 1:00 PM" */
export function formatDateTime(value: string | Date, timeZone?: string): string {
  const date = formatDate(value, timeZone);
  return date === '—' ? date : `${date} · ${formatTime(value, timeZone)}`;
}

/** "1:00 PM – 1:30 PM" */
export function formatTimeRange(start: string | Date, end: string | Date, timeZone?: string): string {
  return `${formatTime(start, timeZone)} – ${formatTime(end, timeZone)}`;
}
