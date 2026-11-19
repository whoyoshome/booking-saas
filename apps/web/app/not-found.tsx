import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-3 text-center">
        <h1 className="font-display text-lg font-semibold text-ink">
          This page does not exist.
        </h1>
        <p className="text-sm text-ink-600">
          Check the address, or go back to the dashboard.
        </p>
        <Link
          href="/dashboard"
          className="inline-block rounded bg-pine px-4 py-2 text-sm font-medium text-white hover:bg-pine-dark"
        >
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
