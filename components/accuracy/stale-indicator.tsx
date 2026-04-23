import { Clock3 } from "lucide-react";
import { isStale } from "./time-ago";

/**
 * Subtle clock icon shown only when data truly risks being stale.
 *
 * Refined rules (Day 9.3 per user QA feedback):
 *
 * - kind='signal': only fires for *transaction-level* signals — T1
 *   Commitment (board minute or press release) — and only when the
 *   signal is older than 30 days. T2 target-change signals are derived
 *   from the most-recent-available CAFR, so "calendar age" doesn't imply
 *   staleness, only publication lag. T3 pacing lives between the two;
 *   keep the old 30-day rule.
 *
 * - kind='allocation': no longer fires based on as-of-date age alone.
 *   CAFR allocations are "as fresh as possible" when we show the most
 *   recent CAFR the pension has published — a 2024 date is accurate,
 *   not stale. To still flag truly outdated rows (e.g., a plan whose
 *   CAFR never re-ingested), pass `exempt=false` explicitly.
 */
export function StaleIndicator({
  date,
  cutoffDays,
  kind,
  signalType,
  exempt,
}: {
  date: string | Date | null | undefined;
  cutoffDays: number;
  kind: "signal" | "allocation";
  signalType?: 1 | 2 | 3 | null;
  exempt?: boolean;
}) {
  if (exempt) return null;
  if (kind === "allocation" && exempt !== false) return null;
  if (kind === "signal" && signalType === 2) return null;
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
