import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-3 text-center">
        <h1 className="font-display text-lg font-semibold text-ink">
          Esta página no existe.
        </h1>
        <p className="text-sm text-ink-600">
          Revisá la dirección, o volvé al dashboard.
        </p>
        <Link
          href="/dashboard"
          className="inline-block rounded bg-pine px-4 py-2 text-sm font-medium text-white hover:bg-pine-dark"
        >
          Ir al dashboard
        </Link>
      </div>
    </main>
  );
}
