import { BOOKING_STATUSES, type StatusFilter as StatusFilterValue } from '../../lib/alerts';
import { STATUS_LABEL } from '../status-style';

interface StatusFilterProps {
  value: StatusFilterValue;
  onChange: (next: StatusFilterValue) => void;
  /** Counts by stored status (ALL = total). Not by priority. */
  counts: Record<StatusFilterValue, number>;
}

const OPTIONS: StatusFilterValue[] = ['ALL', ...BOOKING_STATUSES];

export function StatusFilter({ value, onChange, counts }: StatusFilterProps) {
  return (
    <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2">
      {OPTIONS.map((option) => {
        const active = option === value;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              active
                ? 'border-ink bg-ink text-white'
                : 'border-line bg-surface text-ink-600 hover:border-ink-400'
            }`}
          >
            {option === 'ALL' ? 'All' : STATUS_LABEL[option]}{' '}
            <span className="tabular-nums">({counts[option]})</span>
          </button>
        );
      })}
    </div>
  );
}
