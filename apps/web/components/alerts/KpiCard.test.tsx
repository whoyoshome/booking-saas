import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KpiCard } from './KpiCard';
import { PRIORITY_ICON } from './priority-style';

function renderCard(props: Parameters<typeof KpiCard>[0]) {
  return render(
    <ul>
      <KpiCard {...props} />
    </ul>,
  );
}

describe('KpiCard', () => {
  it('shows the label and the value', () => {
    renderCard({ label: 'Critical', value: 3, priority: 'CRITICAL' });

    const tile = screen.getByRole('listitem');
    expect(tile).toHaveTextContent('Critical');
    expect(tile).toHaveTextContent('3');
  });

  it('shows a zero instead of hiding it', () => {
    renderCard({ label: 'High', value: 0, priority: 'HIGH' });

    expect(screen.getByRole('listitem')).toHaveTextContent('0');
  });

  it('marks the shape next to the label as decorative', () => {
    renderCard({ label: 'Critical', value: 3, priority: 'CRITICAL', emphasized: true });

    expect(screen.getByText(PRIORITY_ICON.CRITICAL)).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps the same content whether or not it is emphasized', () => {
    const { unmount } = renderCard({ label: 'Critical', value: 2, priority: 'CRITICAL', emphasized: true });
    const emphasized = screen.getByRole('listitem').textContent;
    unmount();

    renderCard({ label: 'Critical', value: 2, priority: 'CRITICAL', emphasized: false });
    expect(screen.getByRole('listitem').textContent).toBe(emphasized);
  });
});
