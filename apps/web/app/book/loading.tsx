export default function BookLoading() {
  return (
    <main className="mx-auto max-w-xl p-8">
      <div className="mb-6 h-10 animate-pulse rounded bg-line" />
      <div className="mb-4 h-4 w-40 animate-pulse rounded bg-line" />
      <ul className="space-y-2">
        {[0, 1, 2].map((i) => (
          <li key={i} className="h-14 animate-pulse rounded border border-line bg-line/40" />
        ))}
      </ul>
    </main>
  );
}
