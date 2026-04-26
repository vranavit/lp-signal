/**
 * Unfunded budget per asset class, range-aware.
 *
 * Two cases:
 *
 *   (1) Policy specifies a range (target_min_pct, target_max_pct):
 *       - actual < min  -> gap = (min - actual) / 100 * AUM   (real deployment opportunity)
 *       - actual within -> gap = 0                            (policy endorses, not unfunded)
 *       - actual > max  -> gap = 0                            (overweight, rebalance pressure not deployment)
 *
 *   (2) Policy specifies only a point target (no range):
 *       - actual < target -> gap = (target - actual) / 100 * AUM
 *       - actual >= target -> gap = 0
 *
 * Treating an in-range allocation as "unfunded" overstates the headline --
 * policy explicitly says anywhere in the band is fine. Pre-2026-04-26 the
 * code used (target - actual) regardless of range, which inflated the
 * landing-page hero whenever a plan was in-band but below midpoint. The
 * range-aware version drops the headline figure but is honest under
 * scrutiny from sophisticated buyers (PE IR teams who read CAFRs).
 *
 * Returns 0 (not null) if any required input is missing so calling code can
 * sum across rows without null-handling boilerplate.
 *
 * The "headline number" used on the pension profile and outreach dashboard
 * is the SUM of unfunded budget across the private-markets asset classes
 * (PE / Infra / Credit / RE / VC). Public Equity / Fixed Income / Cash
 * are excluded because they don't generate IR-targetable deployment
 * commitments.
 */

export const PRIVATE_MARKETS_CLASSES = [
  "PE",
  "Infra",
  "Credit",
  "RE",
  "VC",
] as const;

export type AllocationLike = {
  asset_class: string;
  target_pct: number | null;
  target_min_pct?: number | null;
  target_max_pct?: number | null;
  actual_pct: number | null;
  total_plan_aum_usd: number | null;
};

export function unfundedUsd(row: AllocationLike): number {
  if (row.actual_pct == null || row.total_plan_aum_usd == null) return 0;

  const actual = Number(row.actual_pct);
  const aum = Number(row.total_plan_aum_usd);

  if (row.target_min_pct != null && row.target_max_pct != null) {
    const minPct = Number(row.target_min_pct);
    if (actual >= minPct) return 0;
    return Math.round(((minPct - actual) / 100) * aum);
  }

  if (row.target_pct == null) return 0;
  const gapPct = Number(row.target_pct) - actual;
  if (gapPct <= 0) return 0;
  return Math.round((gapPct / 100) * aum);
}

export function privateMarketsUnfundedUsd(rows: AllocationLike[]): number {
  return rows
    .filter((r) =>
      (PRIVATE_MARKETS_CLASSES as readonly string[]).includes(r.asset_class),
    )
    .reduce((acc, r) => acc + unfundedUsd(r), 0);
}

/**
 * Richer version used by UI surfaces that need to communicate which rows
 * actually contributed to the total vs. which were silently zero'd for
 * missing `actual_pct`. See audit finding H-1 (2026-04-23): 25/74
 * allocation rows had NULL `actual_pct` and contributed $0 to the
 * headline, making it a low-side estimate.
 */
export type UnfundedSummary = {
  totalUsd: number;
  withActualsCount: number;
  targetOnlyCount: number;
  perClass: Array<{
    asset_class: string;
    unfunded_usd: number;
    hasActuals: boolean;
  }>;
};

export function privateMarketsUnfundedSummary(
  rows: AllocationLike[],
): UnfundedSummary {
  const pm = rows.filter((r) =>
    (PRIVATE_MARKETS_CLASSES as readonly string[]).includes(r.asset_class),
  );
  let total = 0;
  let withActuals = 0;
  let targetOnly = 0;
  const perClass: UnfundedSummary["perClass"] = [];
  for (const r of pm) {
    const hasActuals = r.actual_pct != null;
    if (hasActuals) withActuals++;
    else targetOnly++;
    const usd = unfundedUsd(r);
    total += usd;
    perClass.push({
      asset_class: r.asset_class,
      unfunded_usd: usd,
      hasActuals,
    });
  }
  return {
    totalUsd: total,
    withActualsCount: withActuals,
    targetOnlyCount: targetOnly,
    perClass,
  };
}
