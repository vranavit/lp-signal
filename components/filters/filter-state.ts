// Shared filter state shape used by /outreach and /signals. Each page only
// consumes the fields it renders controls for; the rest stay at defaults.
//
// URL encoding: arrays → comma-joined; numbers → strings; empty = key
// omitted. See `parseFilters` / `serializeFilters` in use-url-filter-state.

export type ConfidenceTier = "accepted" | "preliminary" | "review";

export type FilterState = {
  query: string;
  assetClasses: string[];
  geographies: string[];
  planIds: string[];
  confidenceTiers: ConfidenceTier[];
  dateRange: string; // "7" | "30" | "60" | "90" | "all"
  checkSizeMin: number; // USD, 0 = no min
  checkSizeMax: number; // USD, 0 = no max (interpreted as Infinity)
  unfundedMin: number; // USD, 0 = no min (outreach only)
  minPriority: number; // 0..100 (signals only)
  minRelevance: number; // 0..100 (signals only)
  directions: string[]; // ["new","increase","decrease"]
};

export const DEFAULT_FILTER_STATE: FilterState = {
  query: "",
  assetClasses: [],
  geographies: [],
  planIds: [],
  confidenceTiers: [],
  dateRange: "all",
  checkSizeMin: 0,
  checkSizeMax: 0,
  unfundedMin: 0,
  minPriority: 0,
  minRelevance: 0,
  directions: [],
};

// Map a signal's raw confidence/priority/preliminary into one of three tiers.
// Accepted:    confidence >= 0.85 AND priority >= 40 AND !preliminary
// Preliminary: confidence >= 0.70 AND < 0.85, OR preliminary=true
// Review:      confidence < 0.70
export function tierFor(
  confidence: number,
  priority: number,
  preliminary: boolean,
): ConfidenceTier {
  if (confidence < 0.7) return "review";
  if (preliminary) return "preliminary";
  if (confidence < 0.85) return "preliminary";
  if (priority < 40) return "preliminary";
  return "accepted";
}

export const CHECK_SIZE_STOPS = [
  0,
  10_000_000,
  25_000_000,
  50_000_000,
  100_000_000,
  200_000_000,
  500_000_000,
  1_000_000_000,
  2_500_000_000,
  5_000_000_000,
];

export const UNFUNDED_STOPS = [
  0,
  100_000_000,
  250_000_000,
  500_000_000,
  1_000_000_000,
  2_500_000_000,
  5_000_000_000,
];

export function labelUsd(n: number): string {
  if (n === 0) return "Any";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(n % 1_000_000_000 === 0 ? 0 : 1)}B`;
  if (n >= 1_000_000) return `$${Math.round(n / 1_000_000)}M`;
  return `$${n}`;
}

// Count of non-default filter fields — for the "N filters" badge.
export function activeFilterCount(s: FilterState): number {
  let n = 0;
  if (s.query.trim()) n++;
  if (s.assetClasses.length) n++;
  if (s.geographies.length) n++;
  if (s.planIds.length) n++;
  if (s.confidenceTiers.length) n++;
  if (s.dateRange !== "all") n++;
  if (s.checkSizeMin > 0) n++;
  if (s.checkSizeMax > 0) n++;
  if (s.unfundedMin > 0) n++;
  if (s.minPriority > 0) n++;
  if (s.minRelevance > 0) n++;
  if (s.directions.length) n++;
  return n;
}
