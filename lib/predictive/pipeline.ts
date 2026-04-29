/**
 * Pipeline integration for cross-source verification.
 *
 * When a `source_verifications` row is written with a confirming
 * verdict (`confirms` / `partially_confirms` / `policy_changed`),
 * affected Type 2 (target allocation change) signals get their
 * `confidence_multiplier` updated.
 *
 * Multiplier semantics per build spec v3 Section 3:
 *   0 confirming verifications -> 1.0 (single-source)
 *   1 confirming verification  -> 1.5 (two-source)
 *   2+ confirming verifications -> 2.0 (three+ source)
 *
 * `conflicts` and `unrelated` do NOT count as confirming.
 *
 * Day 8 (Week 2 Day 1) scope:
 *   - Allocation-allocation pairings only (the v1.1-allocation verifier).
 *   - Only Type 2 signals (signal_type=2) receive multiplier updates.
 *     Type 1 (commitments), Type 3 (pacing), and other signal types
 *     will get their own pairings and pipeline hooks in Month 2.
 *   - Multiplier applied multiplicatively at display time as
 *     `priority_score * confidence_multiplier`. The two columns stay
 *     separate so the classifier-emitted base score and the
 *     verification-derived bonus are independently observable.
 *
 * Mapping rule (defensive on join):
 *   signals.asset_class and pension_allocations.asset_class share the
 *   same canonical enum (verified Day 8 Phase 4 pre-flight). Simple
 *   equality join is correct.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type MultiplierUpdate = {
  updated: number;
  multiplier: number;
  confirmingVerificationCount: number;
};

const CONFIRMING_VERDICTS = [
  "confirms",
  "partially_confirms",
  "policy_changed",
] as const;

const TYPE_2_SIGNAL_TYPE = 2;

/**
 * Recompute and apply the confidence multiplier for all Type 2 signals
 * that match (planId, assetClass). Idempotent: re-running with the same
 * verification state produces the same multiplier.
 *
 * Returns the new multiplier and the row count of signals updated.
 * If no Type 2 signals exist for this (plan, asset class), returns
 * `updated: 0` with the multiplier that *would* have been applied.
 */
export async function applyVerificationToRelatedSignals(
  supabase: SupabaseClient,
  args: { planId: string; assetClass: string },
): Promise<MultiplierUpdate> {
  const { planId, assetClass } = args;

  // Step 1: find all pension_allocations rows for this (plan, asset_class).
  // Both sides of any matching verification reference one of these.
  const { data: allocRows, error: allocErr } = await supabase
    .from("pension_allocations")
    .select("id")
    .eq("plan_id", planId)
    .eq("asset_class", assetClass);
  if (allocErr) {
    throw new Error(`pension_allocations lookup failed: ${allocErr.message}`);
  }
  const allocIds = (allocRows ?? []).map((r) => r.id as string);

  if (allocIds.length === 0) {
    // No allocations for this (plan, asset_class) - nothing to verify.
    // Reset multiplier to 1.0 just in case stale state existed.
    return await applyMultiplier(supabase, { planId, assetClass, multiplier: 1.0, count: 0 });
  }

  // Step 2: count distinct confirming source_verifications rows that
  // touch any of those allocation ids. Query both sides because the
  // canonical-ordered pair index doesn't tell us which UUID is the
  // CAFR vs the IPS at the application layer.
  const verifIds = new Set<string>();

  const { data: a, error: aErr } = await supabase
    .from("source_verifications")
    .select("id")
    .in("verification_type", CONFIRMING_VERDICTS as unknown as string[])
    .in("record_a_id", allocIds);
  if (aErr) throw new Error(`source_verifications (a) lookup failed: ${aErr.message}`);
  for (const r of a ?? []) verifIds.add(r.id as string);

  const { data: b, error: bErr } = await supabase
    .from("source_verifications")
    .select("id")
    .in("verification_type", CONFIRMING_VERDICTS as unknown as string[])
    .in("record_b_id", allocIds);
  if (bErr) throw new Error(`source_verifications (b) lookup failed: ${bErr.message}`);
  for (const r of b ?? []) verifIds.add(r.id as string);

  const count = verifIds.size;
  const multiplier = countToMultiplier(count);

  return await applyMultiplier(supabase, {
    planId,
    assetClass,
    multiplier,
    count,
  });
}

/**
 * Map a confirming-verification count to a multiplier value.
 *
 * Spec v3 Section 3:
 *   single-source (0 confirming verifications) -> 1.0
 *   two-source    (1 confirming verification)  -> 1.5
 *   three+ source (2+ confirming verifications) -> 2.0
 */
export function countToMultiplier(count: number): number {
  if (count <= 0) return 1.0;
  if (count === 1) return 1.5;
  return 2.0;
}

async function applyMultiplier(
  supabase: SupabaseClient,
  args: {
    planId: string;
    assetClass: string;
    multiplier: number;
    count: number;
  },
): Promise<MultiplierUpdate> {
  const { data, error } = await supabase
    .from("signals")
    .update({ confidence_multiplier: args.multiplier })
    .eq("plan_id", args.planId)
    .eq("asset_class", args.assetClass)
    .eq("signal_type", TYPE_2_SIGNAL_TYPE)
    .select("id");

  if (error) {
    throw new Error(`signals.update failed: ${error.message}`);
  }

  return {
    updated: data?.length ?? 0,
    multiplier: args.multiplier,
    confirmingVerificationCount: args.count,
  };
}
