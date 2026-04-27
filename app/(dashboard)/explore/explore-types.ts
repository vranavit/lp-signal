// Types shared between the Explore server page and its client components.

export type ExploreSignal = {
  id: string;
  plan_id: string;
  document_id: string | null;
  fields: Record<string, unknown> | null;
  summary: string;
  source_page: number | null;
  source_quote: string | null;
  commitment_amount_usd: number | null;
  confidence: number;
  priority_score: number;
  preliminary: boolean;
  created_at: string;
  // Joined subset.
  plan: { id: string; name: string } | null;
  document: { id: string; source_url: string; meeting_date: string | null } | null;
};

export type ExplorePlan = { id: string; name: string };

// Approval-type -> abbreviated label for the table column. Full label shown in
// the expanded row.
export const APPROVAL_TYPE_LABELS: Record<string, { abbr: string; full: string }> = {
  board_vote: { abbr: "Board", full: "Board vote" },
  delegation_of_authority: { abbr: "DoA", full: "Delegation of authority" },
  staff_commitment: { abbr: "Staff", full: "Staff commitment" },
  gp_fund_close: { abbr: "Closed", full: "GP fund close" },
};

// The "(other)" bucket is a synthetic key used in the filter and aggregator
// for any T1 row whose fields.approval_type is missing or not in the canonical
// enum. Keeping it as a literal string lets us use it in URL params directly.
export const APPROVAL_TYPE_OTHER = "(other)";

export function approvalTypeAbbr(t: string | null | undefined): string {
  if (!t) return "—";
  return APPROVAL_TYPE_LABELS[t]?.abbr ?? "—";
}

export function approvalTypeFull(t: string | null | undefined): string {
  if (!t) return "—";
  return APPROVAL_TYPE_LABELS[t]?.full ?? t;
}

// Pull a string from the JSONB fields object safely.
export function fieldStr(s: ExploreSignal, key: string): string {
  const f = (s.fields ?? {}) as Record<string, unknown>;
  const v = f[key];
  return typeof v === "string" ? v : "";
}
