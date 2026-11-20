'use client';

import { useState, type FormEvent } from 'react';
import { apiFetch } from '../lib/api-client';
import { AiAssistFrame } from './AiAssistFrame';

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
        const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
        const message = typeof body?.message === 'string' ? body.message : '';
        // "Not configured" (no OPENAI_API_KEY, e.g. this demo's hosted
        // environment) is the documented, expected state — shown as a plain
        // notice. Any other 503 (the model timed out, the upstream failed)
        // carries its own message from the API, shown as-is.
        if (/not configured/i.test(message)) {
          setError('The AI assistant is not configured in this environment (OPENAI_API_KEY is missing).');
        } else {
          setError(message || 'The AI assistant is temporarily unavailable.');
        }
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.message ?? `Could not reach the assistant (${res.status}).`);
        return;
      }

      const body = (await res.json()) as AssistResponse;
      setAnswer(body.answer);
      setGroundedCount(body.groundedOnPendingBookings);
    } catch {
      setError('Could not connect to the assistant.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AiAssistFrame>
      <form onSubmit={handleSubmit} className="flex gap-2">
        {/* The placeholder is an example question, not a label — it
            disappears as soon as someone types. */}
        <label htmlFor="ai-assist-question" className="sr-only">
          Question for the assistant
        </label>
        <input
          id="ai-assist-question"
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="How many pending bookings are there for tomorrow?"
          className="flex-1 rounded-md border px-3 py-1.5 text-sm"
          minLength={3}
          maxLength={500}
          required
        />
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-pine px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-pine-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Asking…' : 'Ask'}
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-3 text-sm text-amber-700">
          {error}
        </p>
      )}

      {answer && (
        <div className="mt-3 rounded-md bg-gray-50 p-3 text-sm">
          <p className="whitespace-pre-wrap">{answer}</p>
          {groundedCount !== null && (
            <p className="mt-2 text-xs text-ink-400">
              Based on {groundedCount} pending booking{groundedCount === 1 ? '' : 's'}.
            </p>
          )}
        </div>
      )}
    </AiAssistFrame>
  );
}
