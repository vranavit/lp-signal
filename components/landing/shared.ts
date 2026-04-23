// Shared landing-page types. The data loaders live in app/page.tsx; the
// section components consume these row shapes. Keeping types here lets
// each component file import only what it needs without reaching back
// into app/page.tsx.

export type LiveStats = {
  unfundedTotal: number;
  signalsCount: number;
  pensionsMonitored: number;
  // Day 9.5 H-1: honest labeling. A pension is "with actuals" when every
  // private-markets row in its latest snapshot has actual_pct set.
  pensionsWithActuals: number;
  pensionsTargetOnly: number;
};

export type CompactSignal = {
  id: string;
  plan_name: string | null;
  gp_name: string | null;
  asset_class: string | null;
  summary: string;
  commitment_amount_usd: number | null;
  meeting_date: string | null;
  created_at: string;
};

export type UnderweightRow = {
  asset_class: string;
  target_pct: number;
  actual_pct: number;
  unfunded_usd: number;
};

export type PolicyChangeRow = {
  plan_name: string;
  asset_class: string;
  previous_target_pct: number;
  new_target_pct: number;
  change_direction: string;
  change_pp: number;
  implied_usd_delta: number | null;
  as_of_date_new: string;
};

export type AuditExample = {
  summary: string;
  source_quote: string;
  source_page: number | null;
  plan_name: string | null;
  doc_type: string;
  meeting_date: string | null;
  commitment_amount_usd: number | null;
  asset_class: string | null;
};

export type OutreachPreviewRow = {
  plan_id: string;
  plan_name: string;
  country: string;
  unfunded_usd: number;
  slug: string | null;
};

export type PipelineCounts = {
  documents: number;
  signals: number;
  allocations: number;
  policyChanges: number;
};

export type GpSignal = {
  id: string;
  gp_name: string;
  asset_class: string | null;
  summary: string;
  commitment_amount_usd: number | null;
  created_at: string;
};
