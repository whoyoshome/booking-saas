// Display helpers for the alerts view. Pure: `now` is always a parameter.

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_DAY = 24 * 60;

/** Minutes from `now` until `iso` (negative if already past; NaN if unparseable). */
export function minutesFromNow(iso: string, now: Date): number {
  return (new Date(iso).getTime() - now.getTime()) / MS_PER_MINUTE;
}

/** 0.4 -> "menos de 1 min", 45 -> "45 min", 135 -> "2 h 15 min", 3000 -> "2 d 2 h". */
export function formatDuration(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes)) return '—';

  const minutes = Math.max(0, Math.round(totalMinutes));
  if (minutes < 1) return 'menos de 1 min';
  if (minutes < 60) return `${minutes} min`;

  if (minutes < MINUTES_PER_DAY) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0 ? `${h} h` : `${h} h ${m} min`;
  }

  const d = Math.floor(minutes / MINUTES_PER_DAY);
  const h = Math.floor((minutes % MINUTES_PER_DAY) / 60);
  return h === 0 ? `${d} d` : `${d} d ${h} h`;
}

/** Hint for a PENDING hold. `minutesLeft <= 0` means the next cron sweep cancels it. */
export function describeExpiry(minutesLeft: number): string {
  if (!Number.isFinite(minutesLeft)) return '';
  return minutesLeft <= 0
    ? 'Plazo vencido: se cancela en el próximo barrido'
    : `Vence en ${formatDuration(minutesLeft)}`;
}

export function describeStart(minutesToStart: number): string {
  if (!Number.isFinite(minutesToStart)) return '';
  return minutesToStart <= 0 ? 'Ya empezó' : `Empieza en ${formatDuration(minutesToStart)}`;
}
