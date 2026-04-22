/**
 * ICP → signal relevance scoring.
 *
 * Pure, stateless, deterministic. Takes the user's firm profile and a signal
 * (with its plan) and returns a 0–100 number. Computed at query time — NOT
 * persisted on the signal, so a profile edit retroactively re-scores every
 * signal on the next page load.
 *
 * Weights (Day 3 spec):
 *   asset_class match   +40
 *   check size match    +30 (or +15 for soft — within 50% outside the band)
 *   geographic match    +20
 *   recency < 90d       +10
 */

export type FirmProfileLite = {
  asset_class_focus: string[];
  check_size_min_usd: number | null;
  check_size_max_usd: number | null;
  geographic_focus: string[];
};

export type SignalForScoring = {
  asset_class: string | null;
  commitment_amount_usd: number | null;
  created_at: string;
  plan: { country: "US" | "CA" | string };
};

// Country → region. We keep it tiny and explicit; extend as we add plans.
const COUNTRY_TO_REGION: Record<string, string> = {
  US: "North America",
  CA: "North America",
  UK: "Europe",
  GB: "Europe",
  DE: "Europe",
  FR: "Europe",
  NL: "Europe",
  AU: "Asia",
  JP: "Asia",
  SG: "Asia",
};

export function regionForCountry(country: string): string {
  return COUNTRY_TO_REGION[country] ?? "Rest of World";
}

export type RelevanceBreakdown = {
  total: number;
  assetClass: number;
  checkSize: number;
  geography: number;
  recency: number;
};

export function computeRelevance(
  signal: SignalForScoring,
  profile: FirmProfileLite,
): RelevanceBreakdown {
  // Asset class match.
  let assetClass = 0;
  if (
    signal.asset_class &&
    profile.asset_class_focus.length > 0 &&
    profile.asset_class_focus.includes(signal.asset_class)
  ) {
    assetClass = 40;
  }

  // Check size match. Hard match = within [min, max]. Soft match = within
  // 50% of either bound (below min or above max). Scoring spec gives +30 for
  // match. We treat "within 50%" as +15 (half points) so users still see
  // near-fit signals.
  let checkSize = 0;
  const amt = signal.commitment_amount_usd;
  const min = profile.check_size_min_usd;
  const max = profile.check_size_max_usd;
  if (amt != null && min != null && max != null && min > 0 && max >= min) {
    if (amt >= min && amt <= max) {
      checkSize = 30;
    } else {
      const softMin = min * 0.5;
      const softMax = max * 1.5;
      if (amt >= softMin && amt <= softMax) {
        checkSize = 15;
      }
    }
  }

  // Geographic match.
  let geography = 0;
  const region = regionForCountry(signal.plan.country);
  if (
    profile.geographic_focus.length > 0 &&
    profile.geographic_focus.includes(region)
  ) {
    geography = 20;
  }

  // Recency < 90d.
  let recency = 0;
  const ts = Date.parse(signal.created_at);
  if (Number.isFinite(ts) && Date.now() - ts <= 90 * 86_400_000) {
    recency = 10;
  }

  const total = assetClass + checkSize + geography + recency;
  return { total, assetClass, checkSize, geography, recency };
}
