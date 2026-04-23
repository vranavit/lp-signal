// Resolve a signal's *real* event date from what the classifier extracted,
// falling back to the linked board-minutes meeting date, and only as a last
// resort to the Allocus ingestion timestamp.
//
// Diagnostic on 2026-04-23 showed /outreach rows displaying "1d ago" for
// PSERS / NYSTRS signals whose actual board approvals were months earlier.
// The fix is purely at the UI layer — the data is already in the row, just
// under signal.fields.approval_date (68/71 rows) or
// signal.document.meeting_date (67/71 rows).

export type EventDateSource = "approval" | "meeting" | "ingestion";

export type ResolvedEventDate = {
  date: string;
  source: EventDateSource;
};

export type EventDateSignal = {
  fields?: Record<string, unknown> | null;
  document?: { meeting_date?: string | null } | null;
  created_at: string;
};

export function resolveEventDate(signal: EventDateSignal): ResolvedEventDate {
  // Prefer fields.approval_date — extracted from the document body for T1
  // commitments. Authoritative when present.
  const approval = signal.fields?.approval_date;
  if (typeof approval === "string" && approval.length >= 10) {
    return { date: approval, source: "approval" };
  }
  // Fallback: the board-meeting date recorded on the source document. Good
  // for T3 pacing and generic board-level events that don't carry their
  // own approval date in the extracted fields.
  const meeting = signal.document?.meeting_date;
  if (meeting) return { date: meeting, source: "meeting" };
  // Last resort: the Allocus ingestion timestamp. Only hit for the ~3 rows
  // with neither an approval_date nor a document meeting_date.
  return { date: signal.created_at, source: "ingestion" };
}

export function eventDateTooltip({
  date,
  source,
}: ResolvedEventDate): string {
  const iso = typeof date === "string" ? date.slice(0, 10) : "";
  if (source === "approval") return `Board approval date: ${iso}`;
  if (source === "meeting") return `Board meeting date: ${iso}`;
  return `Event date unavailable. Showing ingestion date: ${iso}`;
}

export function eventDateSourceLabel(source: EventDateSource): string {
  if (source === "approval") return "board approval";
  if (source === "meeting") return "board meeting";
  return "ingestion only";
}

// Convenience: number of ms between now and the resolved event date.
// Used by callers that want to fire a stale indicator against event time
// rather than ingestion time.
export function eventAgeMs(signal: EventDateSignal): number {
  const { date } = resolveEventDate(signal);
  const t = new Date(date).getTime();
  if (Number.isNaN(t)) return 0;
  return Date.now() - t;
}
