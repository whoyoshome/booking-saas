import type { Priority } from '../../lib/alerts';
import { KPI_ICON, KPI_OFF, KPI_ON, PRIORITY_ICON } from './priority-style';

interface KpiCardProps {
  label: string;
  value: number;
  priority: Priority;
  /** Tint the tile. The page turns it on for CRITICAL/HIGH only when value > 0. */
  emphasized?: boolean;
}

// Rendered as an <li>: the page wraps the tiles in a <ul aria-label="Resumen">.
export function KpiCard({ label, value, priority, emphasized = false }: KpiCardProps) {
  return (
    <li className={`rounded-lg border p-3 ${emphasized ? KPI_ON[priority] : KPI_OFF}`}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-ink-600">
        <span aria-hidden="true" className={emphasized ? KPI_ICON[priority] : 'text-ink-400'}>
          {PRIORITY_ICON[priority]}
        </span>
        {label}
      </p>
      <p className="mt-1 text-3xl font-semibold tabular-nums text-ink">{value}</p>
    </li>
  );
}
