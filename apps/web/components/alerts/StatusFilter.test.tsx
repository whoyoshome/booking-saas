import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { StatusFilter as StatusFilterValue } from '../../lib/alerts';
import { StatusFilter } from './StatusFilter';

const COUNTS: Record<StatusFilterValue, number> = {
  ALL: 15,
  PENDING: 6,
  CONFIRMED: 4,
  CANCELLED: 2,
  COMPLETED: 2,
  NO_SHOW: 1,
};

function setup(value: StatusFilterValue = 'ALL') {
  const onChange = vi.fn();
  render(<StatusFilter value={value} onChange={onChange} counts={COUNTS} />);
  return { onChange, user: userEvent.setup() };
}

describe('StatusFilter', () => {
  it('is a labelled group with one button per option, each with its count', () => {
    setup();

    expect(screen.getByRole('group', { name: 'Filter by status' })).toBeInTheDocument();
    for (const name of [
      'All (15)',
      'Pending (6)',
      'Confirmed (4)',
      'Cancelled (2)',
      'Completed (2)',
      'No-show (1)',
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('marks only the current option as pressed', () => {
    setup('PENDING');

    expect(screen.getByRole('button', { name: 'Pending (6)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'All (15)' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Confirmed (4)' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('reports the clicked status', async () => {
    const { onChange, user } = setup();

    await user.click(screen.getByRole('button', { name: 'No-show (1)' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('NO_SHOW');
  });

  it('reports ALL for "All"', async () => {
    const { onChange, user } = setup('PENDING');

    await user.click(screen.getByRole('button', { name: 'All (15)' }));

    expect(onChange).toHaveBeenCalledWith('ALL');
  });

  it('works from the keyboard: Tab to a chip, Enter or Space picks it', async () => {
    const { onChange, user } = setup('PENDING');

    await user.tab();
    expect(screen.getByRole('button', { name: 'All (15)' })).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('ALL');

    await user.tab();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenLastCalledWith('PENDING');
  });
});
