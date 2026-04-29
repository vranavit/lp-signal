/**
 * Cross-source verification primitive.
 *
 * Per build spec v2.0 Section 5e and Section 10. Verifies allocation
 * records sourced from two different document streams (currently CAFR
 * and IPS) describe consistent policy.
 *
 * Used by the predictive engine to weight signals: a single-source
 * signal carries weight 1.0, a 2-source confirmation 1.5, a 3-source
 * confirmation 2.0, and conflicts get flagged rather than auto-resolved.
 *
 * Verifier version v1.1-allocation (Day 6 of Week 1):
 *
 * The Day 5 v1.0 framing of "decide if two records describe the same
 * event" was wrong for the CAFR-IPS pairing. CAFR captures the policy
 * in force at fiscal year end; IPS captures the policy adopted at the
 * IPS effective date. Comparing across time conflated two different
 * questions: "is this the same policy?" and "did the policy change?"
 *
 * The v1.1 fix has two parts:
 *
 *   1. Temporal pre-filter (buildVerifiablePairs): only compare a CAFR
 *      to the IPS that was in force at the CAFR's fiscal year end. Pairs
 *      where the CAFR predates any IPS we have on file are skipped, not
 *      sent to the model. This eliminates "policy was different in
 *      different generations" being misclassified as conflicts.
 *
 *   2. policy_changed verdict: even within an IPS adoption window, a
 *      plan can revise targets mid-cycle. The model can now distinguish
 *      "values match" (confirms), "values differ but explained by
 *      hierarchy" (partially_confirms), "values differ for legitimate
 *      mid-cycle policy revision" (policy_changed), and "values
 *      genuinely disagree" (conflicts). Conflicts is now rare.
 *
 * Scope and known limits:
 *   - Allocation-allocation pairings only. Signal-signal (commitment
 *     cross-source) and consultant-consultant (de-dup) pairings will
 *     require different semantics, not just different prompts. See
 *     docs/architecture/cross-source-verification-semantics.md.
 *   - The temporal filter is essential. Calling verifyCrossSource on
 *     an arbitrary pair without first running buildVerifiablePairs
 *     produces semantically meaningless conflict signals on legitimate
 *     policy generations.
 *   - Pure function: does NOT write to the database. Caller is
 *     responsible for persisting the result via persistVerification.
 *
 * Day 7 scope (deferred):
 *   - integrate into live ingestion so new allocations / signals
 *     trigger verification against existing rows
 *   - extend to signal-signal and consultant-consultant pairings with
 *     pairing-specific semantics
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CLASSIFIER_MODEL } from "../classifier/extract";
import {
  applyVerificationToRelatedSignals,
  type MultiplierUpdate,
} from "./pipeline";

export const VERIFIER_VERSION = "v1.1-allocation";

/**
 * Verdicts that count as "this verification confirms the underlying
 * pension policy fact." Used by the pipeline to decide whether a
 * source_verifications row should bump the related signals'
 * `confidence_multiplier` and by the orchestrator to decide whether to
 * invoke `applyVerificationToRelatedSignals` after persistence.
 *
 * `conflicts` and `unrelated` are deliberately excluded - a conflict
 * flags a data quality issue (do not strengthen confidence), and an
 * unrelated verdict means the records do not describe the same
 * underlying fact.
 */
export const CONFIRMING_VERDICTS = [
  "confirms",
  "partially_confirms",
  "policy_changed",
] as const;
export type ConfirmingVerdict = (typeof CONFIRMING_VERDICTS)[number];

export type AllocationRecord = {
  id: string;
  plan_id: string;
  plan_name: string;
  asset_class: string;
  sub_class: string | null;
  target_pct: number | null;
  target_min_pct: number | null;
  target_max_pct: number | null;
  as_of_date: string;
  prompt_version: string;
  source_excerpt: string | null;
};

export type VerificationType =
  | "confirms"
  | "partially_confirms"
  | "policy_changed"
  | "conflicts"
  | "unrelated";

/**
 * Temporal relationship between a CAFR row and an IPS row.
 *
 * Only `cafr_within_ips_window` pairs should be sent to the verifier.
 * `cafr_predates_ips` pairs are pre-IPS-adoption snapshots and would
 * compare two different policy generations. `ips_predates_cafr_window`
 * pairs are superseded IPS rows where a newer IPS was adopted before
 * the CAFR fiscal year end; the older IPS is no longer in force.
 */
export type TemporalRelationship =
  | "cafr_within_ips_window"
  | "cafr_predates_ips"
  | "ips_predates_cafr_window";

export type AllocationPair = {
  cafr: AllocationRecord;
  ips: AllocationRecord;
  temporal_relationship: TemporalRelationship;
};

export type VerificationResult = {
  same_event: boolean;
  verification_type: VerificationType;
  confidence: number;
  rationale: string;
};

const responseSchema = z.object({
  verification_type: z.enum([
    "confirms",
    "partially_confirms",
    "policy_changed",
    "conflicts",
    "unrelated",
  ]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1).max(2000),
});

const recordVerificationToolSchema: Tool = {
  name: "record_verification",
  description:
    "Record the outcome of comparing two pension plan allocation records.",
  input_schema: {
    type: "object",
    properties: {
      verification_type: {
        type: "string",
        enum: [
          "confirms",
          "partially_confirms",
          "policy_changed",
          "conflicts",
          "unrelated",
        ],
      },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      rationale: { type: "string" },
    },
    required: ["verification_type", "confidence", "rationale"],
  },
};

/**
 * Compare two allocation records. Returns the verification verdict.
 * Pure function: does NOT write to the database. Caller persists the
 * result via persistVerification when they want it on disk.
 */
export async function verifyCrossSource(
  recordA: AllocationRecord,
  recordB: AllocationRecord,
): Promise<VerificationResult> {
  // Cheap pre-checks. Different plan = trivially unrelated.
  if (recordA.plan_id !== recordB.plan_id) {
    return {
      same_event: false,
      verification_type: "unrelated",
      confidence: 1.0,
      rationale: "Different plan_id — records are about different pension plans.",
    };
  }

  // Different asset class with no sub_class overlap = trivially unrelated.
  // We let the classifier disambiguate when sub_class matters (e.g. CalPERS
  // PE vs CalPERS Public Equity is unrelated; CalPERS Public Equity vs
  // CalPERS Public Equity / Cap Weighted is potentially related — model
  // call needed).
  if (recordA.asset_class !== recordB.asset_class) {
    return {
      same_event: false,
      verification_type: "unrelated",
      confidence: 1.0,
      rationale:
        `Different asset_class (${recordA.asset_class} vs ${recordB.asset_class}) — records are about different sleeves of the plan portfolio.`,
    };
  }

  const prompt = buildPrompt(recordA, recordB);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("missing ANTHROPIC_API_KEY");
  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model: CLASSIFIER_MODEL,
    max_tokens: 1024,
    tools: [recordVerificationToolSchema],
    tool_choice: { type: "tool", name: "record_verification" },
    messages: [{ role: "user", content: prompt }],
  });

  const toolUse = message.content.find(
    (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
  );
  if (!toolUse || toolUse.name !== "record_verification") {
    throw new Error(
      `cross-source verifier did not call record_verification tool (stop_reason=${message.stop_reason})`,
    );
  }

  const parsed = responseSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new Error(
      `cross-source verifier output failed schema validation: ${parsed.error.message}`,
    );
  }

  const v = parsed.data;
  // policy_changed describes a legitimate mid-window policy revision,
  // not a different event. The records are still about the same plan +
  // asset class, just at different points within one IPS adoption
  // window. Treated as same_event for downstream confidence weighting.
  return {
    same_event:
      v.verification_type === "confirms" ||
      v.verification_type === "partially_confirms" ||
      v.verification_type === "policy_changed",
    verification_type: v.verification_type,
    confidence: v.confidence,
    rationale: v.rationale,
  };
}

function buildPrompt(a: AllocationRecord, b: AllocationRecord): string {
  return `You are verifying two pension plan allocation records that have already been pre-filtered to be temporally aligned. The CAFR's fiscal year end falls inside the IPS's adoption window (the IPS is the policy in force at the CAFR's date). Your job is to decide whether the values match, differ for an explainable reason, or genuinely disagree.

## Record A

- Plan: ${a.plan_name}
- Asset class: ${a.asset_class}${a.sub_class ? ` / ${a.sub_class}` : ""}
- Target: ${fmtPct(a.target_pct)}% (range: ${fmtPct(a.target_min_pct)}-${fmtPct(a.target_max_pct)}%)
- As of: ${a.as_of_date.slice(0, 10)}
- Source: ${a.prompt_version}
- Excerpt: ${a.source_excerpt ?? "(none)"}

## Record B

- Plan: ${b.plan_name}
- Asset class: ${b.asset_class}${b.sub_class ? ` / ${b.sub_class}` : ""}
- Target: ${fmtPct(b.target_pct)}% (range: ${fmtPct(b.target_min_pct)}-${fmtPct(b.target_max_pct)}%)
- As of: ${b.as_of_date.slice(0, 10)}
- Source: ${b.prompt_version}
- Excerpt: ${b.source_excerpt ?? "(none)"}

## Decision

Output one of:

- **confirms** - same plan, same asset class, values agree within 0.5 percentage point. Both records correctly describe the policy.

- **partially_confirms** - value gap is fully explained by hierarchy mismatch: one record captures the parent class while the other captures a sub-sleeve, or one source rolls up what the other splits. Sub_class labels may differ but describe components of the same parent allocation.

- **policy_changed** - both records are valid but the policy was revised within the IPS adoption window. Use when: same plan, same asset class, both records at the parent or matching sub_class level, values differ by 1 to 4 percentage points (or ranges shift while the target is similar), AND the gap is consistent with normal mid-cycle policy drift between IPS adoption and the CAFR fiscal year end. Pension plans regularly revise targets within a single IPS adoption period, especially for asset classes undergoing transition. This is NOT a conflict.

- **conflicts** - values differ by 3 or more percentage points AND no hierarchy explanation fits AND the gap is too large to be normal drift (for example, a parent class showing only sub-sleeve magnitude, suggesting an extraction mis-aggregation rather than a policy revision). This is the rare flag for genuine data quality issues.

- **unrelated** - different plan, different asset class, OR sub_class labels describe genuinely different sleeves within the same parent class.

CRITICAL CALIBRATION:

- Conflicts should be RARE in this filtered dataset. The temporal pre-filter already removed pre-adoption pairs, which is where most "conflicts" came from in v1.0.
- When the gap is 1 to 4 percentage points on a parent or matching sub_class, prefer **policy_changed** over conflicts. Pension plans drift their targets all the time.
- When the gap could be hierarchy mismatch (one parent vs one sub-sleeve), prefer **partially_confirms** over conflicts.
- Use **conflicts** only when the magnitude of the gap or the structure of the values cannot be explained by either policy drift or hierarchy. Example pattern: parent class showing 3.5% when the asset class is typically a 5-15% allocation, suggesting the CAFR extraction captured a sub-sleeve and labeled it the parent.

Note on sources: prompt_version="v1.0-ips" rows come from the plan's Investment Policy Statement (the policy adopted at the IPS effective date). prompt_version like "%cafr%" rows come from the plan's Comprehensive Annual Financial Report (a snapshot of policy in effect at fiscal year end). The CAFR may capture a mid-cycle revision the IPS did not anticipate; that is policy_changed, not conflicts.

Call the record_verification tool exactly once with { "verification_type": ..., "confidence": 0.0-1.0, "rationale": "1-2 sentences" }. The rationale must explain the decision and reference the specific values when relevant.`;
}

function fmtPct(v: number | null): string {
  if (v === null || v === undefined) return "null";
  return v.toFixed(2);
}

/**
 * Persist a verification verdict to source_verifications. Idempotent via
 * the unique pair index — re-running on the same (a, b, verifier_version)
 * triple updates instead of inserting a duplicate.
 */
export async function persistVerification(
  supabase: SupabaseClient,
  args: {
    recordA: AllocationRecord;
    recordB: AllocationRecord;
    result: VerificationResult;
  },
): Promise<{ id: string }> {
  const { recordA, recordB, result } = args;
  // Order canonically (smaller UUID first) so the unique index doesn't
  // double-fire when the caller flips arguments. Postgres still enforces
  // it via least()/greatest() on read, but writing in canonical order
  // avoids a 23505 we'd then have to handle.
  const [first, second] =
    recordA.id < recordB.id ? [recordA, recordB] : [recordB, recordA];

  const payload = {
    record_a_type: "allocation" as const,
    record_a_id: first.id,
    record_b_type: "allocation" as const,
    record_b_id: second.id,
    verification_type: result.verification_type,
    confidence: result.confidence,
    rationale: result.rationale,
    verifier_version: VERIFIER_VERSION,
  };

  // Upsert via insert + ignore conflict. The unique index uses
  // least()/greatest() on the id pair, so even un-canonical inputs would
  // still collide on a re-run; the canonical ordering above is just
  // belt-and-braces.
  const { data: existing } = await supabase
    .from("source_verifications")
    .select("id")
    .eq("record_a_id", first.id)
    .eq("record_b_id", second.id)
    .eq("verifier_version", VERIFIER_VERSION)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("source_verifications")
      .update({
        verification_type: payload.verification_type,
        confidence: payload.confidence,
        rationale: payload.rationale,
      })
      .eq("id", existing.id);
    if (error) throw new Error(`update failed: ${error.message}`);
    return { id: existing.id };
  }

  const { data: inserted, error } = await supabase
    .from("source_verifications")
    .insert(payload)
    .select("id")
    .single();
  if (error || !inserted) {
    throw new Error(`insert failed: ${error?.message ?? "no row"}`);
  }
  return { id: inserted.id };
}

/**
 * Verify a CAFR-IPS allocation pair, persist the verdict, and apply
 * the confidence multiplier to related Type 2 signals if the verdict
 * is confirming. Use this as the entry point from ingestion pipelines.
 *
 * The underlying primitives (`verifyCrossSource`, `persistVerification`,
 * `applyVerificationToRelatedSignals`) remain exported for callers that
 * need finer control - e.g., backfill scripts that already have the
 * verdict and only need to persist + apply.
 */
export async function verifyPersistAndApply(
  supabase: SupabaseClient,
  recordA: AllocationRecord,
  recordB: AllocationRecord,
): Promise<{
  verification: VerificationResult;
  verificationId: string;
  multiplierUpdate: MultiplierUpdate | null;
}> {
  const verification = await verifyCrossSource(recordA, recordB);
  const { id: verificationId } = await persistVerification(supabase, {
    recordA,
    recordB,
    result: verification,
  });

  const isConfirming = (CONFIRMING_VERDICTS as readonly string[]).includes(
    verification.verification_type,
  );

  // recordA and recordB share plan_id + asset_class by construction
  // (buildVerifiablePairs filters on these). Use recordA as the source
  // of truth for the multiplier scope.
  const multiplierUpdate = isConfirming
    ? await applyVerificationToRelatedSignals(supabase, {
        planId: recordA.plan_id,
        assetClass: recordA.asset_class,
      })
    : null;

  return { verification, verificationId, multiplierUpdate };
}

export type PlanVerificationOutcome = {
  pairsConsidered: number;
  pairsAlreadyVerified: number;
  pairsVerified: number;
  errors: { pair: string; message: string }[];
};

/**
 * Run cross-source verification on every eligible allocation pair for
 * a plan, skipping any pair that already has a v1.1-allocation
 * verification on file. Idempotent: re-running with no new allocations
 * does no model calls and writes nothing.
 *
 * Used by the IPS and CAFR classifier paths after a successful
 * `pension_allocations` insert. The classifier passes only `planId` -
 * this function refetches the plan's full allocation set, runs
 * `buildVerifiablePairs`, filters out already-verified pairs, and
 * calls `verifyPersistAndApply` for the rest.
 *
 * Errors on individual pairs are caught and accumulated; the function
 * never throws so a verifier failure cannot abort the classifier path.
 */
export async function verifyAllocationsForPlan(
  supabase: SupabaseClient,
  args: { planId: string },
): Promise<PlanVerificationOutcome> {
  const outcome: PlanVerificationOutcome = {
    pairsConsidered: 0,
    pairsAlreadyVerified: 0,
    pairsVerified: 0,
    errors: [],
  };

  const { data: rows, error } = await supabase
    .from("pension_allocations")
    .select(
      "id, plan_id, asset_class, sub_class, target_pct, target_min_pct, target_max_pct, as_of_date, prompt_version, source_quote, plans!inner(name)",
    )
    .eq("plan_id", args.planId)
    .or("prompt_version.eq.v1.0-ips,prompt_version.like.%cafr%");
  if (error) {
    outcome.errors.push({ pair: "_fetch", message: error.message });
    return outcome;
  }

  const records: AllocationRecord[] = (rows ?? []).map((r: any) => ({
    id: r.id,
    plan_id: r.plan_id,
    plan_name: r.plans?.name ?? "",
    asset_class: r.asset_class,
    sub_class: r.sub_class,
    target_pct: r.target_pct === null ? null : Number(r.target_pct),
    target_min_pct:
      r.target_min_pct === null ? null : Number(r.target_min_pct),
    target_max_pct:
      r.target_max_pct === null ? null : Number(r.target_max_pct),
    as_of_date:
      typeof r.as_of_date === "string"
        ? r.as_of_date
        : new Date(r.as_of_date).toISOString().slice(0, 10),
    prompt_version: r.prompt_version,
    source_excerpt: r.source_quote ?? null,
  }));

  const pairs = buildVerifiablePairs(records);
  outcome.pairsConsidered = pairs.length;
  if (pairs.length === 0) return outcome;

  // Look up which of these pairs already have a v1.1-allocation row.
  // persistVerification stores pairs canonically (smaller UUID first),
  // so every existing row has record_a_id = min(pair.cafr.id, pair.ips.id).
  // We query record_a_id IN (... all alloc ids touching pairs ...) which
  // covers the canonical-side check. The unique pair index uses
  // least()/greatest() so order-flipping is also detected at write time.
  const idsTouchingPairs = new Set<string>();
  for (const p of pairs) {
    idsTouchingPairs.add(p.cafr.id);
    idsTouchingPairs.add(p.ips.id);
  }

  const { data: existing, error: existingErr } = await supabase
    .from("source_verifications")
    .select("record_a_id, record_b_id")
    .eq("verifier_version", VERIFIER_VERSION)
    .in("record_a_id", [...idsTouchingPairs]);
  if (existingErr) {
    outcome.errors.push({ pair: "_existing_lookup", message: existingErr.message });
    return outcome;
  }

  const verifiedKeys = new Set<string>();
  for (const v of existing ?? []) {
    verifiedKeys.add(canonicalPairKey(v.record_a_id as string, v.record_b_id as string));
  }

  for (const pair of pairs) {
    const key = canonicalPairKey(pair.cafr.id, pair.ips.id);
    if (verifiedKeys.has(key)) {
      outcome.pairsAlreadyVerified++;
      continue;
    }
    try {
      await verifyPersistAndApply(supabase, pair.cafr, pair.ips);
      outcome.pairsVerified++;
    } catch (e) {
      outcome.errors.push({
        pair: `${pair.cafr.id}+${pair.ips.id}`,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return outcome;
}

function canonicalPairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Build the set of allocation pairs that are temporally eligible for
 * cross-source verification.
 *
 * For each CAFR row, finds the IPS that was in force at the CAFR's
 * fiscal year end - the most recent IPS for the same (plan, asset_class,
 * sub_class) whose as_of_date is at or before the CAFR's as_of_date.
 *
 * If multiple IPS rows for the same (plan, asset_class) share the
 * in-force date but split into different sub_classes (the CalPERS
 * pattern: parent CAFR vs IPS sub-sleeves), each in-force IPS row is
 * paired separately with the CAFR. The model then decides whether each
 * pair is partially_confirms (parent-vs-sub-sleeve) or unrelated
 * (different sleeves at the sub_class level).
 *
 * CAFR rows with no IPS in force at their date are dropped silently:
 * comparing them to a later IPS would conflate two different policy
 * generations and produce semantically meaningless conflict signals.
 *
 * Pairs with both records carrying non-null sub_class but with mismatched
 * sub_class strings are also dropped, because they describe genuinely
 * different sleeves and would always be 'unrelated' (no need to spend
 * tokens confirming).
 *
 * Returns only pairs with temporal_relationship === 'cafr_within_ips_window'.
 * The other enum values are documented in the type for future use (e.g.,
 * an ingestion-time helper that records why a pair was rejected).
 */
export function buildVerifiablePairs(
  allocations: AllocationRecord[],
): AllocationPair[] {
  const isIps = (r: AllocationRecord) => r.prompt_version.includes("ips");
  const isCafr = (r: AllocationRecord) => r.prompt_version.includes("cafr");

  const ipsRows = allocations.filter(isIps);
  const cafrRows = allocations.filter(isCafr);

  const pairs: AllocationPair[] = [];

  for (const cafr of cafrRows) {
    // All IPS rows that share plan + asset_class with the CAFR.
    const compatibleIps = ipsRows.filter(
      (ips) =>
        ips.plan_id === cafr.plan_id &&
        ips.asset_class === cafr.asset_class,
    );
    if (compatibleIps.length === 0) continue;

    // Group by sub_class and pick the most recent in-force IPS row per
    // sub_class. An "in force" row has as_of_date <= cafr.as_of_date.
    const inForceBySubClass = new Map<string, AllocationRecord>();
    for (const ips of compatibleIps) {
      if (ips.as_of_date > cafr.as_of_date) continue; // not yet adopted
      const key = ips.sub_class ?? "__NULL__";
      const existing = inForceBySubClass.get(key);
      if (!existing || ips.as_of_date > existing.as_of_date) {
        inForceBySubClass.set(key, ips);
      }
    }

    if (inForceBySubClass.size === 0) {
      // No IPS adopted yet at the CAFR's date. CAFR predates all IPS
      // rows we have for this plan + asset_class. Skip - comparing
      // would conflate generations.
      continue;
    }

    for (const ips of inForceBySubClass.values()) {
      // Drop sub_class mismatches (both non-null and different).
      if (
        cafr.sub_class &&
        ips.sub_class &&
        cafr.sub_class !== ips.sub_class
      ) {
        continue;
      }
      pairs.push({
        cafr,
        ips,
        temporal_relationship: "cafr_within_ips_window",
      });
    }
  }

  return pairs;
}
