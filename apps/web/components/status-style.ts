import type { Booking } from '../lib/types';

// Single place that maps a stored booking status to what the UI shows,
// same idea as alerts/priority-style.ts. The API values (PENDING, NO_SHOW…)
// never change; only the label, color and shape shown for them live here.
//
// Status carries meaning through color, not just text — same three-color
// system used across the app (pine = confirmed/good, gold = pending/needs
// attention, rust = cancelled/failed). COMPLETED and NO_SHOW share the
// neutral/rust treatment since they're both "no longer actionable".

type BookingStatus = Booking['status'];

export const STATUS_LABEL: Record<BookingStatus, string> = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
  NO_SHOW: 'No-show',
};

export const STATUS_BADGE: Record<BookingStatus, string> = {
  PENDING: 'bg-gold-bg text-gold-dark',
  CONFIRMED: 'bg-pine-bg text-pine-dark',
  CANCELLED: 'bg-rust-bg text-rust-dark',
  COMPLETED: 'bg-line text-ink-600',
  NO_SHOW: 'bg-rust-bg text-rust-dark',
};

// Left border on each row repeats the status color so a long list can be
// scanned by color alone, without reading the badge text. PENDING also
// gets a tinted row background: it's the only state that needs action.
export const STATUS_ROW: Record<BookingStatus, string> = {
  PENDING: 'border-l-gold bg-gold-bg/40',
  CONFIRMED: 'border-l-pine bg-surface',
  CANCELLED: 'border-l-rust bg-surface',
  COMPLETED: 'border-l-ink-400 bg-surface',
  NO_SHOW: 'border-l-rust bg-surface',
};

export const STATUS_ICON: Record<BookingStatus, string> = {
  PENDING: '⏱',
  CONFIRMED: '✓',
  CANCELLED: '✕',
  COMPLETED: '✓',
  NO_SHOW: '!',
};
