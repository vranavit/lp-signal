// Relative + absolute timestamp: shows "2d ago"; tooltip shows full ISO by
// default, or a caller-supplied title when more context is available
// (e.g. "Board approval date: 2025-09-12" for signal rows after the
// event-date fix in Day 9.4).
// Server-renderable (no useEffect); the `title` attribute handles hover.

export function TimeAgo({
  date,
  className = "",
  title,
}: {
  date: string | Date | null | undefined;
  className?: string;
  title?: string;
}) {
  if (!date) {
    return (
      <span
        className={
          "font-mono tabular-nums text-[11px] text-ink-faint " + className
        }
      >
        —
      </span>
    );
  }
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) {
    return (
      <span
        className={
          "font-mono tabular-nums text-[11px] text-ink-faint " + className
        }
      >
        —
      </span>
    );
  }
  const ms = Date.now() - d.getTime();
  const days = Math.floor(ms / 86_400_000);
  const label =
    days <= 0
      ? "today"
      : days === 1
      ? "1d ago"
      : days < 30
      ? `${days}d ago`
      : days < 365
      ? `${Math.floor(days / 30)}mo ago`
      : `${Math.floor(days / 365)}y ago`;
  const defaultTitle =
    d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  return (
    <span
      title={title ?? defaultTitle}
      className={
        "font-mono tabular-nums text-[11px] text-ink-faint cursor-help " +
        className
      }
    >
      {label}
    </span>
  );
}

export function isStale(
  date: string | Date | null | undefined,
  cutoffDays: number,
): boolean {
  if (!date) return false;
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return false;
  return Date.now() - d.getTime() > cutoffDays * 86_400_000;
}
