"use client";

import { ChevronRight } from "lucide-react";
import { formatUSD } from "@/lib/utils";

export function ExploreStatsStrip({
  commitments,
  totalUsd,
  gpCount,
  planCount,
  onOpenGps,
  onOpenPlans,
}: {
  commitments: number;
  totalUsd: number;
  gpCount: number;
  planCount: number;
  onOpenGps: () => void;
  onOpenPlans: () => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
      <StatCard label="Commitments" value={commitments.toLocaleString()} />
      <StatCard label="Total $" value={formatUSD(totalUsd)} />
      <StatCard
        label="Unique GPs"
        value={gpCount.toLocaleString()}
        onClick={gpCount > 0 ? onOpenGps : undefined}
      />
      <StatCard
        label="Plans covered"
        value={planCount.toLocaleString()}
        onClick={planCount > 0 ? onOpenPlans : undefined}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick?: () => void;
}) {
  const Inner = (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10.5px] text-ink-faint uppercase tracking-wide">
          {label}
        </span>
        {onClick ? (
          <ChevronRight
            className="h-3 w-3 text-ink-faint group-hover:text-ink"
            strokeWidth={1.75}
          />
        ) : null}
      </div>
      <div className="mt-1 num tabular-nums text-[20px] font-semibold text-ink leading-tight">
        {value}
      </div>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="card-surface group px-3 py-2.5 text-left hover:border-line-strong hover:bg-bg-hover transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg"
      >
        {Inner}
      </button>
    );
  }
  return <div className="card-surface px-3 py-2.5">{Inner}</div>;
}
