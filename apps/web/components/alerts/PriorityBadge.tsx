import type { Priority } from '../../lib/alerts';
import { PRIORITY_BADGE, PRIORITY_ICON, PRIORITY_LABEL } from './priority-style';

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold ${PRIORITY_BADGE[priority]}`}
    >
      <span aria-hidden="true">{PRIORITY_ICON[priority]}</span>
      {PRIORITY_LABEL[priority]}
    </span>
  );
}
