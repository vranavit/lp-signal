import {
  FilterBarSkeleton,
  Skeleton,
  TableSkeleton,
} from "@/components/ui/skeleton";

export default function OutreachLoading() {
  return (
    <div className="space-y-4">
      <div>
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-3 w-72 mt-2" />
      </div>
      <section className="card-surface">
        <div className="px-3 py-2.5 border-b border-line flex items-center gap-3">
          <Skeleton className="h-8 flex-1" />
          <Skeleton className="h-8 w-[140px]" />
          <Skeleton className="h-8 w-[120px]" />
        </div>
        <TableSkeleton rows={5} columns={4} />
      </section>
      <FilterBarSkeleton />
      <TableSkeleton rows={10} columns={9} />
    </div>
  );
}
