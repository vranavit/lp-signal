export type SignalType = 1 | 2 | 3;

export type AssetClass = "PE" | "Infra" | "Credit" | "RE" | "VC" | "Other";

export type Plan = {
  id: string;
  name: string;
  country: "US" | "CA";
  aum_usd: number | null;
  tier: number | null;
  scrape_method: "board_minutes" | "press_release" | "annual_report" | "manual" | null;
  scrape_url: string | null;
  scrape_config: Record<string, unknown> | null;
  last_scraped_at: string | null;
  active: boolean;
  created_at: string;
};

export type DocumentRow = {
  id: string;
  plan_id: string;
  document_type: string | null;
  source_url: string;
  content_hash: string;
  storage_path: string | null;
  meeting_date: string | null;
  published_at: string | null;
  processed_at: string | null;
  processing_status: "pending" | "processing" | "complete" | "error";
  error_message: string | null;
};

export type SignalRow = {
  id: string;
  document_id: string | null;
  plan_id: string;
  signal_type: SignalType;
  confidence: number;
  priority_score: number;
  asset_class: AssetClass | null;
  summary: string;
  fields: Record<string, unknown>;
  source_page: number | null;
  source_quote: string | null;
  commitment_amount_usd: number | null;
  seed_data: boolean;
  created_at: string;
};

export type SignalWithPlan = SignalRow & {
  plan: Pick<Plan, "id" | "name" | "country" | "aum_usd">;
};
