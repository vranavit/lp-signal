/**
 * Resolve which AUM number to display for a plan.
 *
 * Two sources exist:
 *   - plans.aum_usd                      -- editorial round number, hand-curated
 *   - pension_allocations_rollup
 *       .total_plan_aum_usd              -- precise figure from the latest CAFR
 *
 * The CAFR figure is the more accurate number 95% of the time -- it is the
 * audited fund value as of the fiscal year-end. When sources disagree wildly,
 * however, that is a strong signal that the wrong document was ingested for
 * this plan (e.g. CalPERS' CERBT Strategy 1 SAA review at $20B labeled as
 * PERF data instead of the $500B+ PERF ACFR). The 0.5x-2x sanity guard
 * catches that class of ingestion error and falls back to the editorial
 * value, with a server-side warning for ops triage.
 */

export type PlanAumSource = "allocation" | "plan_table" | "none";

export type PlanAumResolution = {
  value: number | null;
  source: PlanAumSource;
  asOfDate: string | null;
};

const MIN_RATIO = 0.5;
const MAX_RATIO = 2.0;

export function resolvePlanAum(
  planAum: number | null | undefined,
  allocAum: number | null | undefined,
  asOfDate: string | null | undefined,
  planNameForLog?: string,
): PlanAumResolution {
  const planN = planAum != null ? Number(planAum) : null;
  const allocN = allocAum != null ? Number(allocAum) : null;

  if (allocN != null && planN != null && planN > 0) {
    const ratio = allocN / planN;
    if (ratio < MIN_RATIO || ratio > MAX_RATIO) {
      console.warn(
        `[plan-aum] anomaly${planNameForLog ? ` for ${planNameForLog}` : ""}: alloc=${allocN} plan=${planN} ratio=${ratio.toFixed(2)} -- using plans.aum_usd`,
      );
      return { value: planN, source: "plan_table", asOfDate: null };
    }
    return { value: allocN, source: "allocation", asOfDate: asOfDate ?? null };
  }
  if (allocN != null) {
    return { value: allocN, source: "allocation", asOfDate: asOfDate ?? null };
  }
  if (planN != null) {
    return { value: planN, source: "plan_table", asOfDate: null };
  }
  return { value: null, source: "none", asOfDate: null };
}
