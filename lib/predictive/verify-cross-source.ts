/**
 * Cross-source verification primitive.
 *
 * Per build spec v2.0 Section 5e and Section 10. Takes two records
 * (currently only allocation-allocation pairings; signal-signal and
 * consultant-consultant pairings are planned for later weeks) and
 * decides whether they describe the same official policy / same event.
 *
 * Used by the predictive engine to weight signals: a single-source
 * signal carries weight 1.0, a 2-source confirmation 1.5, a 3-source
 * confirmation 2.0, and conflicts get flagged rather than auto-resolved.
 *
 * Day 5 scope:
 *   - allocation-allocation only
 *   - synchronous function (caller awaits the verdict)
 *   - cheap pre-check on plan_id and asset_class avoids the API round
 *     trip when the answer is obviously "unrelated"
 *   - no automatic write to source_verifications; caller is responsible
 *     for persisting the result via persistVerification (also exported)
 *
 * Day 6/7 scope (deferred):
 *   - integrate into live ingestion so new allocations / signals trigger
 *     verification against existing rows
 *   - signal-signal pairings (commitment cross-source)
 *   - consultant-consultant pairings (de-dup canonicalization)
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CLASSIFIER_MODEL } from "../classifier/extract";

export const VERIFIER_VERSION = "v1.0-allocation";

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
  | "conflicts"
  | "unrelated";

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
        enum: ["confirms", "partially_confirms", "conflicts", "unrelated"],
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
  return {
    same_event:
      v.verification_type === "confirms" ||
      v.verification_type === "partially_confirms",
    verification_type: v.verification_type,
    confidence: v.confidence,
    rationale: v.rationale,
  };
}

function buildPrompt(a: AllocationRecord, b: AllocationRecord): string {
  return `You are verifying whether two pension plan allocation records describe the same official policy.

## Record A

- Plan: ${a.plan_name}
- Asset class: ${a.asset_class}${a.sub_class ? ` / ${a.sub_class}` : ""}
- Target: ${fmtPct(a.target_pct)}% (range: ${fmtPct(a.target_min_pct)}–${fmtPct(a.target_max_pct)}%)
- As of: ${a.as_of_date.slice(0, 10)}
- Source: ${a.prompt_version}
- Excerpt: ${a.source_excerpt ?? "(none)"}

## Record B

- Plan: ${b.plan_name}
- Asset class: ${b.asset_class}${b.sub_class ? ` / ${b.sub_class}` : ""}
- Target: ${fmtPct(b.target_pct)}% (range: ${fmtPct(b.target_min_pct)}–${fmtPct(b.target_max_pct)}%)
- As of: ${b.as_of_date.slice(0, 10)}
- Source: ${b.prompt_version}
- Excerpt: ${b.source_excerpt ?? "(none)"}

## Decision

Are these records describing the same plan's official policy on the same asset class for an overlapping time period?

Output one of:
- **confirms** — same plan, same asset class, same time period, same value (within rounding, ≤ 0.5 percentage point). High confidence both records correctly describe the policy.
- **partially_confirms** — same plan, same asset class, same time period, values differ but within reasonable interpretation: one captures the parent class while the other captures a sub-sleeve, or sub_class labels differ but describe the same underlying policy, or one source rolls up what the other splits.
- **conflicts** — same plan, same asset class, same time period, materially different values (≥ 3 percentage points off) AND no plausible interpretation that reconciles them. One record is likely wrong.
- **unrelated** — non-overlapping time periods (more than ~24 months apart so they describe different policy generations), OR sub_class labels describe genuinely different sleeves within the same parent class.

CRITICAL: When uncertain between confirms and partially_confirms, prefer **partially_confirms**. When uncertain between conflicts and partially_confirms, prefer **partially_confirms**. Only use **conflicts** when the values differ by 3+ percentage points and you cannot explain the difference.

Note on sources: prompt_version="v1.0-ips" rows come from the plan's Investment Policy Statement (the canonical adopted policy). prompt_version like "%cafr%" rows come from the plan's Comprehensive Annual Financial Report (a snapshot of policy in effect at fiscal year end). When both describe the same period, they should describe the same underlying policy — but CAFR extraction occasionally rolls up sub-sleeves the IPS splits, which is a partially_confirms case, not conflicts.

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
