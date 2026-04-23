export function Skeleton({
  className = "",
}: {
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={
        "animate-pulse rounded-sm bg-gradient-to-r from-bg-panel via-bg-hover to-bg-panel " +
        className
      }
    />
  );
}

export function TableSkeleton({
  rows = 8,
  columns = 8,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div className="card-surface overflow-hidden">
      <div className="h-9 bg-bg-subtle border-b border-line px-3 flex items-center gap-4">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-16" />
        ))}
      </div>
      <div>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="h-11 border-b border-line last:border-b-0 px-3 flex items-center gap-4 odd:bg-black/[0.015] dark:odd:bg-white/[0.02]"
          >
            {Array.from({ length: columns }).map((_, j) => (
              <Skeleton
                key={j}
                className={"h-3 " + (j === columns - 1 ? "w-8" : j === 0 ? "w-10" : "w-20")}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function FilterBarSkeleton() {
  return (
    <div className="card-surface flex flex-wrap items-center gap-2 px-2.5 py-2">
      <Skeleton className="h-8 flex-1 min-w-[220px]" />
      <Skeleton className="h-8 w-[140px]" />
      <Skeleton className="h-8 w-[140px]" />
      <Skeleton className="h-8 w-[140px]" />
      <Skeleton className="h-8 w-[140px]" />
      <div className="flex-1" />
      <Skeleton className="h-8 w-[80px]" />
    </div>
  );
}
