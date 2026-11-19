// Route-segment Suspense fallback, same role as dashboard/loading.tsx: it
// covers "getting to the page at all"; the page's own "Cargando reservas…"
// covers "the page is here, its data isn't yet".
function SkeletonTile() {
  return <li className="h-20 animate-pulse rounded-lg border border-line bg-line" />;
}

function SkeletonRow() {
  return <li className="h-24 animate-pulse rounded-lg border border-line bg-line" />;
}

export default function AlertsLoading() {
  return (
    <main className="mx-auto max-w-5xl p-8">
      <div className="mb-6 h-10 animate-pulse rounded bg-line" />
      <ul className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SkeletonTile />
        <SkeletonTile />
        <SkeletonTile />
        <SkeletonTile />
      </ul>
      <ul className="grid gap-2 lg:grid-cols-2">
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </ul>
    </main>
  );
}
