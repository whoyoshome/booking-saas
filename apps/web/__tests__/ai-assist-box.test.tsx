import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AiAssistBox } from '../components/AiAssistBox';
import { mockApi, deferred, type FakeResponse } from './support/mock-api';

test('shows a loading state while asking, then a clear notice when the assistant is not configured (503)', async () => {
  const assist = deferred<FakeResponse>();
  mockApi({ 'POST /ai/assist': () => assist.promise });
  const user = userEvent.setup();

  render(<AiAssistBox />);
  await user.type(screen.getByRole('textbox'), '¿Cuántas pendientes hay mañana?');
  await user.click(screen.getByRole('button', { name: 'Preguntar' }));

  expect(screen.getByRole('button', { name: 'Preguntando...' })).toBeDisabled();

  assist.resolve({ status: 503, body: { message: 'AI assist is not configured' } });

  expect(await screen.findByText(/no está configurado en este entorno/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Preguntar' })).toBeEnabled();
});
