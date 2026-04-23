/**
 * Unfunded budget = (target_pct − actual_pct) / 100 × total_plan_aum_usd.
 *
 * Per Day 5 spec, capped at zero on the negative side: an overweight
 * position has no deployable budget, just rebalancing pressure. Returns 0
 * (not null) if any input is missing so calling code can sum across rows
 * without null-handling boilerplate.
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
  actual_pct: number | null;
  total_plan_aum_usd: number | null;
};

export function unfundedUsd(row: AllocationLike): number {
  if (
    row.target_pct == null ||
    row.actual_pct == null ||
    row.total_plan_aum_usd == null
  ) {
    return 0;
  }
  const gapPct = Number(row.target_pct) - Number(row.actual_pct);
  if (gapPct <= 0) return 0;
  return Math.round((gapPct / 100) * Number(row.total_plan_aum_usd));
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
