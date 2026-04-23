import { Clock3 } from "lucide-react";
import { isStale } from "./time-ago";

/**
 * Subtle clock icon rendered only when the date crosses the freshness
 * cutoff (30 days for signals, 90 days for allocations). Tooltip explains.
 */
export function StaleIndicator({
  date,
  cutoffDays,
  kind,
}: {
  date: string | Date | null | undefined;
  cutoffDays: number;
  kind: "signal" | "allocation";
}) {
  if (!isStale(date, cutoffDays)) return null;
  const label =
    kind === "signal"
      ? `Signal older than ${cutoffDays} days — data may be stale`
      : `Allocation older than ${cutoffDays} days — check for newer CAFR`;
  return (
    <span
      title={label}
      className="inline-flex items-center text-ink-faint hover:text-ink cursor-help"
    >
      <Clock3 className="h-3 w-3" strokeWidth={1.75} aria-label={label} />
    </span>
  );
}

export { isStale };
