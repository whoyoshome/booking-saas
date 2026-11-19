import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred, mockApi, type FakeResponse } from '../test/mock-api';
import { AiAssistBox } from './AiAssistBox';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AiAssistBox', () => {
  it('shows a loading state while asking, then a clear notice when the assistant is not configured (503)', async () => {
    const assist = deferred<FakeResponse>();
    mockApi({ 'POST /ai/assist': () => assist.promise });
    const user = userEvent.setup();

    render(<AiAssistBox />);
    await user.type(screen.getByLabelText('Question for the assistant'), 'How many are pending tomorrow?');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    expect(screen.getByRole('button', { name: 'Asking…' })).toBeDisabled();

    assist.resolve({ status: 503, body: { message: 'AI assist is not configured' } });

    expect(await screen.findByText(/not configured in this environment/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask' })).toBeEnabled();
  });
});
