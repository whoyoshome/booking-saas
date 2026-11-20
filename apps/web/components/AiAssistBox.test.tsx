import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred, mockApi, type FakeResponse } from '../test/mock-api';
import { AiAssistBox } from './AiAssistBox';

afterEach(() => {
  vi.unstubAllGlobals();
});

async function ask() {
  const user = userEvent.setup();
  render(<AiAssistBox />);
  await user.type(screen.getByLabelText('Question for the assistant'), 'How many are pending tomorrow?');
  await user.click(screen.getByRole('button', { name: 'Ask' }));
}

describe('AiAssistBox', () => {
  it('shows a loading state while asking, then a clear notice when the assistant is not configured (503)', async () => {
    const assist = deferred<FakeResponse>();
    mockApi({ 'POST /ai/assist': () => assist.promise });

    await ask();

    expect(screen.getByRole('button', { name: 'Asking…' })).toBeDisabled();

    assist.resolve({ status: 503, body: { message: 'AI assist is not configured' } });

    expect(await screen.findByText(/not configured in this environment/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask' })).toBeEnabled();
  });

  it("uses the not-configured notice for the API's exact missing-key message", async () => {
    mockApi({
      'POST /ai/assist': {
        status: 503,
        body: { message: 'AI assist is not configured on this environment (missing OPENAI_API_KEY).' },
      },
    });

    await ask();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The AI assistant is not configured in this environment (OPENAI_API_KEY is missing).',
    );
  });

  it.each([
    'AI assist did not answer in time.',
    'AI assist is temporarily unavailable.',
  ])('shows the API message for any other 503: "%s"', async (message) => {
    mockApi({ 'POST /ai/assist': { status: 503, body: { message } } });

    await ask();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(message);
    expect(alert).not.toHaveTextContent(/not configured/i);
  });

  it('says the assistant is temporarily unavailable when a 503 has no message, not that it is unconfigured', async () => {
    mockApi({ 'POST /ai/assist': { status: 503 } });

    await ask();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The AI assistant is temporarily unavailable.');
    expect(alert).not.toHaveTextContent(/not configured/i);
  });
});
