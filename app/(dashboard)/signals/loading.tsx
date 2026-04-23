import {
  FilterBarSkeleton,
  TableSkeleton,
} from "@/components/ui/skeleton";

export default function SignalsLoading() {
  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div className="h-5 w-24 animate-pulse bg-bg-panel rounded-sm" />
        <div className="h-5 w-28 animate-pulse bg-bg-panel rounded-sm" />
      </div>
      <FilterBarSkeleton />
      <div className="flex gap-3 items-stretch">
        <div className="flex-1 min-w-0">
          <TableSkeleton rows={10} columns={9} />
        </div>
        <div className="w-[400px] shrink-0 hidden lg:block">
          <div className="card-surface h-[520px] animate-pulse" />
        </div>
      </div>
    </div>
  );
}
