import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeBooking, minutesFrom, NOW, pending } from '../../test/helpers';
import type { Booking } from '../../lib/types';
import { AlertRow } from './AlertRow';

function renderRow(booking: Booking, showManageLink = false) {
  render(
    <ul>
      <AlertRow booking={booking} now={NOW} showManageLink={showManageLink} />
    </ul>,
  );
  return screen.getByRole('listitem');
}

describe('AlertRow — PENDING', () => {
  it('a critical hold shows its priority, status and both countdowns', () => {
    const row = renderRow(pending(2, 40));

    expect(row).toHaveTextContent('Critical');
    expect(row).toHaveTextContent('PENDING');
    expect(row).toHaveTextContent('Expires in 2 min');
    expect(row).toHaveTextContent('Starts in 40 min');
  });

  it('a non-urgent hold is High and shows how long until it starts', () => {
    const row = renderRow(pending(7, 24 * 60));

    expect(row).toHaveTextContent('High');
    expect(row).toHaveTextContent('Expires in 7 min');
    expect(row).toHaveTextContent('Starts in 1 d');
  });

  it('an expired hold says the next sweep will cancel it', () => {
    const row = renderRow(pending(-2, 500));

    expect(row).toHaveTextContent('Critical');
    expect(row).toHaveTextContent('Hold expired: cancelled on the next sweep');
  });

  it('a hold that already started says so', () => {
    expect(renderRow(pending(9, -30))).toHaveTextContent('Already started');
  });
});

describe('AlertRow — CONFIRMED', () => {
  it('an upcoming one is Normal, plain CONFIRMED, and shows when it starts', () => {
    const row = renderRow(makeBooking({ startTime: minutesFrom(90), endTime: minutesFrom(120) }));

    expect(row).toHaveTextContent('Normal');
    expect(row).toHaveTextContent('Starts in 1 h 30 min');
    expect(row).not.toHaveTextContent('ended');
    expect(row).not.toHaveTextContent('Expires');
  });

  it('one that is over reads as closed: "CONFIRMED · ended", no countdowns', () => {
    const row = renderRow(
      makeBooking({ startTime: minutesFrom(-3 * 24 * 60), endTime: minutesFrom(-3 * 24 * 60 + 30) }),
    );

    expect(row).toHaveTextContent('CONFIRMED · ended');
    expect(row).toHaveTextContent('Closed');
    expect(row).not.toHaveTextContent('Normal');
    expect(row).not.toHaveTextContent('Starts');
    expect(row).not.toHaveTextContent('Expires');
    // Deliberate style assertion: a finished CONFIRMED must not look active.
    expect(row).toHaveClass('border-l-ink-400');
  });

  it('one in progress is still Normal, not ended', () => {
    const row = renderRow(makeBooking({ startTime: minutesFrom(-10), endTime: minutesFrom(20) }));

    expect(row).toHaveTextContent('Normal');
    expect(row).not.toHaveTextContent('ended');
  });
});

describe('AlertRow — closed statuses', () => {
  it.each(['CANCELLED', 'COMPLETED', 'NO_SHOW'] as const)('%s is Closed with no countdowns', (status) => {
    const row = renderRow(makeBooking({ status }));

    expect(row).toHaveTextContent(status);
    expect(row).toHaveTextContent('Closed');
    expect(row).not.toHaveTextContent('ended');
    expect(row).not.toHaveTextContent('Starts');
  });
});

describe('AlertRow — content and links', () => {
  it('shows service, branch, staff and client', () => {
    const row = renderRow(makeBooking());

    expect(row).toHaveTextContent('Haircut');
    expect(row).toHaveTextContent('Downtown Branch');
    expect(row).toHaveTextContent('ana@tenant-a.dev');
    expect(row).toHaveTextContent('Client: cliente@example.com');
  });

  it('falls back to the ids when the relations are missing (e.g. a POST response)', () => {
    const row = renderRow(
      makeBooking({
        serviceId: 'svc-9',
        branchId: 'br-9',
        staffId: 'st-9',
        service: undefined,
        branch: undefined,
        staff: undefined,
        client: undefined,
      }),
    );

    expect(row).toHaveTextContent('svc-9');
    expect(row).toHaveTextContent('br-9 · st-9');
    expect(row).not.toHaveTextContent('Client:');
  });

  it('links a PENDING row to the dashboard when asked to', () => {
    renderRow(pending(5, 500), true);

    expect(screen.getByRole('link', { name: 'Resolve on the dashboard' })).toHaveAttribute('href', '/dashboard');
  });

  it('does not link a PENDING row when not asked to (demo mode)', () => {
    renderRow(pending(5, 500), false);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('never links a row that is not PENDING', () => {
    renderRow(makeBooking(), true);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
