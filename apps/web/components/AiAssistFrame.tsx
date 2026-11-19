import type { ReactNode } from 'react';

/**
 * The assistant's static frame (heading + description). Kept in its own
 * tiny module so the dashboard can render it as the loading placeholder
 * WITHOUT importing AiAssistBox itself — that import is what next/dynamic
 * splits into a separate chunk.
 */
export function AiAssistFrame({ children }: { children: ReactNode }) {
  return (
    <section className="mb-8 rounded-lg border p-4">
      <h2 className="mb-1 text-sm font-medium text-ink-600">Assistant (beta)</h2>
      <p className="mb-3 text-xs text-ink-400">
        Answers only from the pending bookings of this business. It never creates, confirms or cancels anything.
      </p>
      {children}
    </section>
  );
}

/** Same height as the form row (text-sm input, py-1.5, 1px border). */
export function AiAssistPlaceholder() {
  return (
    <AiAssistFrame>
      <div aria-hidden="true" className="h-[34px] animate-pulse rounded-md bg-line" />
    </AiAssistFrame>
  );
}
