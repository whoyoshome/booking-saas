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

    expect(row).toHaveTextContent('Crítica');
    expect(row).toHaveTextContent('PENDING');
    expect(row).toHaveTextContent('Vence en 2 min');
    expect(row).toHaveTextContent('Empieza en 40 min');
  });

  it('a non-urgent hold is High and shows how long until it starts', () => {
    const row = renderRow(pending(7, 24 * 60));

    expect(row).toHaveTextContent('Alta');
    expect(row).toHaveTextContent('Vence en 7 min');
    expect(row).toHaveTextContent('Empieza en 1 d');
  });

  it('an expired hold says the next sweep will cancel it', () => {
    const row = renderRow(pending(-2, 500));

    expect(row).toHaveTextContent('Crítica');
    expect(row).toHaveTextContent('Plazo vencido: se cancela en el próximo barrido');
  });

  it('a hold that already started says so', () => {
    expect(renderRow(pending(9, -30))).toHaveTextContent('Ya empezó');
  });
});

describe('AlertRow — CONFIRMED', () => {
  it('an upcoming one is Normal, plain CONFIRMED, and shows when it starts', () => {
    const row = renderRow(makeBooking({ startTime: minutesFrom(90), endTime: minutesFrom(120) }));

    expect(row).toHaveTextContent('Normal');
    expect(row).toHaveTextContent('Empieza en 1 h 30 min');
    expect(row).not.toHaveTextContent('finalizada');
    expect(row).not.toHaveTextContent('Vence');
  });

  it('one that is over reads as closed: "CONFIRMED · finalizada", no countdowns', () => {
    const row = renderRow(
      makeBooking({ startTime: minutesFrom(-3 * 24 * 60), endTime: minutesFrom(-3 * 24 * 60 + 30) }),
    );

    expect(row).toHaveTextContent('CONFIRMED · finalizada');
    expect(row).toHaveTextContent('Cerrada');
    expect(row).not.toHaveTextContent('Normal');
    expect(row).not.toHaveTextContent('Empieza');
    expect(row).not.toHaveTextContent('Vence');
    // Deliberate style assertion: a finished CONFIRMED must not look active.
    expect(row).toHaveClass('border-l-ink-400');
  });

  it('one in progress is still Normal, not finalizada', () => {
    const row = renderRow(makeBooking({ startTime: minutesFrom(-10), endTime: minutesFrom(20) }));

    expect(row).toHaveTextContent('Normal');
    expect(row).not.toHaveTextContent('finalizada');
  });
});

describe('AlertRow — closed statuses', () => {
  it.each(['CANCELLED', 'COMPLETED', 'NO_SHOW'] as const)('%s is Cerrada with no countdowns', (status) => {
    const row = renderRow(makeBooking({ status }));

    expect(row).toHaveTextContent(status);
    expect(row).toHaveTextContent('Cerrada');
    expect(row).not.toHaveTextContent('finalizada');
    expect(row).not.toHaveTextContent('Empieza');
  });
});

describe('AlertRow — content and links', () => {
  it('shows service, branch, staff and client', () => {
    const row = renderRow(makeBooking());

    expect(row).toHaveTextContent('Corte de cabello');
    expect(row).toHaveTextContent('Sucursal Centro');
    expect(row).toHaveTextContent('ana@tenant-a.dev');
    expect(row).toHaveTextContent('Cliente: cliente@example.com');
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
    expect(row).not.toHaveTextContent('Cliente:');
  });

  it('links a PENDING row to the dashboard when asked to', () => {
    renderRow(pending(5, 500), true);

    expect(screen.getByRole('link', { name: 'Resolver en el dashboard' })).toHaveAttribute('href', '/dashboard');
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
