'use client';

import { useState, type FormEvent } from 'react';
import { apiFetch } from '../lib/api-client';

interface AssistResponse {
  answer: string;
  groundedOnPendingBookings: number;
}

/**
 * Rendered by the dashboard ONLY when `user.role` is TENANT_ADMIN or
 * STAFF (see dashboard/page.tsx) — this component itself does not
 * re-check the role; the API is the real enforcement point (@Roles on
 * POST /ai/assist), this is just UI-level "don't show a button a CLIENT
 * can't use."
 */
export function AiAssistBox() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [groundedCount, setGroundedCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setAnswer(null);
    setSubmitting(true);

    try {
      const res = await apiFetch('/ai/assist', {
        method: 'POST',
        body: JSON.stringify({ question }),
      });

      if (res.status === 503) {
        // The documented, expected state when OPENAI_API_KEY isn't
        // configured (e.g. this demo's own hosted environment, unless a
        // key was explicitly added) — not a bug, shown as a plain notice.
        setError('El asistente de IA no está configurado en este entorno (falta OPENAI_API_KEY).');
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.message ?? `No se pudo consultar al asistente (${res.status}).`);
        return;
      }

      const body = (await res.json()) as AssistResponse;
      setAnswer(body.answer);
      setGroundedCount(body.groundedOnPendingBookings);
    } catch {
      setError('No se pudo conectar con el asistente.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mb-8 rounded-lg border p-4">
      <h2 className="mb-1 text-sm font-medium text-gray-500">Asistente (beta)</h2>
      <p className="mb-3 text-xs text-gray-400">
        Responde solo con las reservas PENDING de este tenant — nunca crea, confirma ni cancela nada.
      </p>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="¿Cuántas reservas pendientes hay para mañana?"
          className="flex-1 rounded-md border px-3 py-1.5 text-sm"
          minLength={3}
          maxLength={500}
          required
        />
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {submitting ? 'Preguntando...' : 'Preguntar'}
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-amber-700">{error}</p>}

      {answer && (
        <div className="mt-3 rounded-md bg-gray-50 p-3 text-sm">
          <p className="whitespace-pre-wrap">{answer}</p>
          {groundedCount !== null && (
            <p className="mt-2 text-xs text-gray-400">
              Basado en {groundedCount} reserva{groundedCount === 1 ? '' : 's'} pendiente
              {groundedCount === 1 ? '' : 's'}.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
