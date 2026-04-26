/**
 * Range-aware classification of an actual allocation versus its policy band.
 *
 * Many CAFR policy tables specify a *range* (min - max) per asset class, not
 * a single point target. When a range is present, the right way to think
 * about deployment opportunity is "is the actual below the band, in the
 * band, or above the band" -- not "actual minus target".
 *
 * Treating an in-range allocation as though it has a gap overstates the
 * "unfunded budget" headline, since policy explicitly endorses anywhere in
 * the band. The honest math: only allocations BELOW the minimum represent
 * a real deployment opportunity, and the gap dollars are computed against
 * the minimum (not the midpoint).
 *
 * positionPct is a continuous 0-100 signal indicating where the actual sits
 * inside the band -- 0 = at the floor, 50 = midpoint, 100 = at the ceiling.
 * Useful for sub-IR signals like "drifting toward the upper bound".
 */

export type RangeClassification =
  | { kind: "below"; gapPp: number }
  | {
      kind: "within";
      positionPct: number;
      band: "low" | "mid" | "high";
    }
  | { kind: "above"; gapPp: number };

export function classifyVsRange(
  actualPct: number,
  minPct: number,
  maxPct: number,
): RangeClassification {
  if (actualPct < minPct) {
    return { kind: "below", gapPp: Number((minPct - actualPct).toFixed(2)) };
  }
  if (actualPct > maxPct) {
    return { kind: "above", gapPp: Number((actualPct - maxPct).toFixed(2)) };
  }
  if (maxPct === minPct) {
    return { kind: "within", positionPct: 50, band: "mid" };
  }
  const positionPct = ((actualPct - minPct) / (maxPct - minPct)) * 100;
  const band = positionPct < 33 ? "low" : positionPct > 67 ? "high" : "mid";
  return {
    kind: "within",
    positionPct: Number(positionPct.toFixed(1)),
    band,
  };
}

/**
 * Friendly label for the within-range band position. Used in UI badges.
 */
export function bandLabel(band: "low" | "mid" | "high"): string {
  if (band === "low") return "low end";
  if (band === "high") return "high end";
  return "midpoint";
}
