import type { Priority } from '../../lib/alerts';

// Single place that maps a priority to its look. Priority is never carried
// by color alone: each level also has its own shape and its own label, so
// the list still reads for color-blind users and in grayscale.
//
// Each class string sets a given CSS property exactly once — never put two
// bg-*/text-*/border-* utilities for the same property on one element and
// expect the last one to win (Tailwind emits them in its own order).

export const PRIORITY_LABEL: Record<Priority, string> = {
  CRITICAL: 'Crítica',
  HIGH: 'Alta',
  NORMAL: 'Normal',
  CLOSED: 'Cerrada',
};

export const PRIORITY_ICON: Record<Priority, string> = {
  CRITICAL: '▲',
  HIGH: '◆',
  NORMAL: '●',
  CLOSED: '○',
};

export const PRIORITY_BADGE: Record<Priority, string> = {
  CRITICAL: 'bg-rust text-white',
  // text-ink, not gold-dark: gold-dark on gold-bg is 4.1:1, under WCAG AA (4.5).
  HIGH: 'bg-gold-bg text-ink',
  NORMAL: 'bg-pine-bg text-pine-dark',
  CLOSED: 'bg-line text-ink-600',
};

// Left border + background of a list row. Only CRITICAL and HIGH are tinted,
// so the rows that need action stand out from the rest.
export const PRIORITY_ROW: Record<Priority, string> = {
  CRITICAL: 'border-l-rust bg-rust-bg/50',
  HIGH: 'border-l-gold bg-gold-bg/40',
  NORMAL: 'border-l-pine bg-surface',
  CLOSED: 'border-l-ink-400 bg-surface',
};

// KPI tiles: the value itself always stays in neutral ink; state is carried
// by the border, the tint and the shape beside the label.
export const KPI_ON: Record<Priority, string> = {
  CRITICAL: 'border-rust bg-rust-bg',
  HIGH: 'border-gold bg-gold-bg',
  NORMAL: 'border-pine bg-pine-bg',
  CLOSED: 'border-line bg-surface',
};

export const KPI_OFF = 'border-line bg-surface';

export const KPI_ICON: Record<Priority, string> = {
  CRITICAL: 'text-rust',
  HIGH: 'text-gold',
  NORMAL: 'text-pine',
  CLOSED: 'text-ink-400',
};
