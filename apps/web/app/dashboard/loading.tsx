// Route-segment Suspense fallback — Next.js shows this automatically
// while this route's JS chunk is being prepared during navigation. It's
// a different moment from the `branches === null` / `bookings === null`
// states inside dashboard/page.tsx: this covers "getting to the page at
// all", those cover "the page is here, its data isn't yet".
function SkeletonRow() {
  return (
    <li className="flex items-center justify-between rounded border border-line p-3">
      <span className="h-4 w-32 animate-pulse rounded bg-line" />
      <span className="h-4 w-16 animate-pulse rounded bg-line" />
    </li>
  );
}

export default function DashboardLoading() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <div className="mb-6 h-10 animate-pulse rounded bg-line" />
      <div className="mb-8 space-y-2">
        <div className="mb-3 h-4 w-24 animate-pulse rounded bg-line" />
        <ul className="grid gap-2 sm:grid-cols-2">
          <SkeletonRow />
          <SkeletonRow />
        </ul>
      </div>
      <div className="space-y-2">
        <div className="mb-3 h-4 w-24 animate-pulse rounded bg-line" />
        <ul className="space-y-2">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </ul>
      </div>
    </main>
  );
}
