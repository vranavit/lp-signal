import { Skeleton, TableSkeleton } from "@/components/ui/skeleton";

// Skeleton for /pensions/[slug] matching the page structure:
// back-link, hero card (plan name + metadata + unfunded widget),
// 3-card stat strip, allocation table, consultants section.
export default function PensionPageLoading() {
  return (
    <div className="space-y-4 max-w-5xl">
      {/* Back link */}
      <Skeleton className="h-4 w-16" />

      {/* Hero card: plan name + metadata on left, unfunded widget on right */}
      <section className="card-surface px-5 py-5">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-3 w-3/4 mt-2.5" />
          </div>
          <div className="text-right shrink-0 space-y-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-3 w-36" />
          </div>
        </div>
      </section>

      {/* Stat strip: 3 cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card-surface px-4 py-3 space-y-2">
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-2.5 w-32" />
        </div>
        <div className="card-surface px-4 py-3 space-y-2">
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-2.5 w-32" />
        </div>
        <div className="card-surface px-4 py-3 space-y-2">
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-2.5 w-32" />
        </div>
      </div>

      {/* Asset Allocation table */}
      <section className="card-surface">
        <div className="px-4 py-3 border-b border-line space-y-1.5">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-2.5 w-2/3" />
        </div>
        <TableSkeleton rows={6} columns={8} />
      </section>

      {/* Investment Consultants section */}
      <section className="card-surface">
        <div className="px-4 py-3 border-b border-line space-y-1.5">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-2.5 w-56" />
        </div>
        <div className="px-4 py-3 space-y-2">
          <Skeleton className="h-2.5 w-16" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
        </div>
      </section>
    </div>
  );
}
