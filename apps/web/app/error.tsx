'use client';

import { useEffect } from 'react';

/**
 * Root error boundary — catches anything an individual page's own
 * try/catch + component state didn't (a render-time exception, not a
 * failed fetch; those are handled inline per-page already, e.g.
 * dashboard/page.tsx's `error`/`bookingsError` state). Next.js requires
 * error.tsx to be a Client Component.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-4 rounded border border-line bg-surface p-6 text-center shadow-panel">
        <h1 className="font-display text-lg font-semibold text-ink">
          Something broke on our side.
        </h1>
        <p className="text-sm text-ink-600">
          We could not show this screen. You can try again or go back to the dashboard.
        </p>
        <div className="flex justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={reset}
            className="rounded bg-pine px-4 py-2 text-sm font-medium text-white hover:bg-pine-dark"
          >
            Try again
          </button>
          <a
            href="/dashboard"
            className="rounded border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-paper"
          >
            Go to dashboard
          </a>
        </div>
      </div>
    </main>
  );
}
