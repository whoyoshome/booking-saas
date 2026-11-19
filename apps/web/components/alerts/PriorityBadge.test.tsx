import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PRIORITIES } from '../../lib/alerts';
import { PriorityBadge } from './PriorityBadge';
import { PRIORITY_ICON, PRIORITY_LABEL } from './priority-style';

describe('PriorityBadge', () => {
  it.each(PRIORITIES)('%s shows its own label and shape', (priority) => {
    render(<PriorityBadge priority={priority} />);

    expect(screen.getByText(PRIORITY_LABEL[priority])).toBeInTheDocument();
    expect(screen.getByText(PRIORITY_ICON[priority])).toBeInTheDocument();
  });

  it('hides the shape from assistive tech (the label already says it)', () => {
    render(<PriorityBadge priority="CRITICAL" />);

    expect(screen.getByText(PRIORITY_ICON.CRITICAL)).toHaveAttribute('aria-hidden', 'true');
  });

  it('never carries priority by color alone: every level has a distinct label and shape', () => {
    const labels = new Set(PRIORITIES.map((p) => PRIORITY_LABEL[p]));
    const shapes = new Set(PRIORITIES.map((p) => PRIORITY_ICON[p]));

    expect(labels.size).toBe(PRIORITIES.length);
    expect(shapes.size).toBe(PRIORITIES.length);
  });
});
