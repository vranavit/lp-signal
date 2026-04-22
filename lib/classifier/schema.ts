import { z } from "zod";
import { jsonrepair } from "jsonrepair";

// Private-markets-only coverage (v2.2). "Other" was dropped because it was
// the escape hatch that let public-equity mandates and unclassifiable rows
// leak through. If the classifier can't place a commitment in one of these
// five classes, the prompt instructs it to omit the signal.
export const ASSET_CLASSES = [
  "PE",
  "Infra",
  "Credit",
  "RE",
  "VC",
] as const;

const assetClassEnum = z.enum(ASSET_CLASSES);

const commonBase = {
  confidence: z.number().min(0).max(1),
  evidence_strength: z.number().int().min(0).max(100),
  summary: z.string().min(1),
  source_page: z.number().int().min(1),
  source_quote: z.string().min(1),
};

export const APPROVAL_TYPES = [
  "board_vote",
  "delegation_of_authority",
  "staff_commitment",
  // Added in v2.2-gp: GP press-release fund-close announcements. Distinct
  // provenance from pension-side approvals — the "approval" here is the GP
  // declaring the fund closed, not an LP board voting.
  "gp_fund_close",
] as const;

const approvalTypeEnum = z.enum(APPROVAL_TYPES);

// Fund-stage tracking for GP press releases. Used for downstream dedup
// across sequential announcements of the same fund (first → interim → final
// → hard_cap). Optional on every T1; pension-side signals leave it null.
export const FUND_STAGES = [
  "first_close",
  "interim_close",
  "final_close",
  "hard_cap",
] as const;

const fundStageEnum = z.enum(FUND_STAGES);

const t1Fields = z.object({
  gp: z.string().min(1),
  fund_name: z.string().min(1),
  // Must be > 0. The prompt's hard-guardrail says omit the signal if the
  // document doesn't state the dollar amount; the schema enforces it as a
  // second defense so zero never reaches the DB.
  amount_usd: z.number().int().positive(),
  asset_class: assetClassEnum,
  approval_date: z.string().nullable().optional(),
  approval_type: approvalTypeEnum,
  // Press-release-only optional fields. Pension-side T1s omit these.
  named_lps: z.array(z.string().min(1)).optional(),
  fund_stage: fundStageEnum.nullable().optional(),
});

const t2Fields = z.object({
  asset_class: assetClassEnum,
  old_target_pct: z.number(),
  new_target_pct: z.number(),
  timeline: z.string().nullable().optional(),
  implied_delta_usd: z.number().int().nullable().optional(),
});

const t3Fields = z.object({
  asset_class: assetClassEnum,
  prior_year_pacing_usd: z.number().int().nonnegative(),
  new_year_pacing_usd: z.number().int().nonnegative(),
  pct_change: z.number(),
});

const signalSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal(1), ...commonBase, fields: t1Fields }),
  z.object({ type: z.literal(2), ...commonBase, fields: t2Fields }),
  z.object({ type: z.literal(3), ...commonBase, fields: t3Fields }),
]);

// Default to [] when the tool call omits the `signals` key entirely.
// Observed once in Phase 2 validation against Sonnet 4.6; harmless to allow
// since an empty array matches "no qualifying signals in this document".
//
// The `signals` field is wrapped in a z.preprocess that tolerates Anthropic
// occasionally returning the array as a JSON-encoded string (observed once
// on a Blackstone press release in Phase 3 validation). When the coercion
// fires we log a warning so we can track how often it happens — if it
// becomes frequent we'll escalate to a retry layer; for now a preprocess is
// enough. Malformed JSON falls through to the normal array-validation error
// so the message stays readable.
export const classifierResponseSchema = z.object({
  signals: z
    .preprocess((v) => {
      if (typeof v !== "string") return v;
      // Stage 1 — strict JSON.parse. Handles the clean-stringification case.
      try {
        const parsed = JSON.parse(v);
        console.warn(
          "[classifier] signals was stringified, coerced via preprocessor",
        );
        return parsed;
      } catch {
        // fall through to repair
      }
      // Stage 2 — jsonrepair. Handles the messier case where the stringified
      // JSON contains unescaped double quotes inside string values (observed
      // on Blackstone press releases where source_quote cited a nickname in
      // quotes, e.g. `("COF V")`).
      try {
        const repaired = jsonrepair(v);
        const parsed = JSON.parse(repaired);
        console.warn(
          "[classifier] signals was stringified with malformed JSON, recovered via jsonrepair",
        );
        return parsed;
      } catch (err) {
        console.warn(
          `[classifier] signals was stringified and jsonrepair could not recover: ${err instanceof Error ? err.message : String(err)}`,
        );
        return v;
      }
    }, z.array(signalSchema).default([])),
});

export type ClassifiedSignal = z.infer<typeof signalSchema>;
export type ClassifierResponse = z.infer<typeof classifierResponseSchema>;

import type { Tool } from "@anthropic-ai/sdk/resources/messages";

// JSON Schema for the Anthropic tool. Uses a permissive `fields: object`
// because Anthropic tool schemas don't cleanly support discriminated unions.
// Strict validation happens in TypeScript via `classifierResponseSchema`.
export const recordSignalsToolSchema: Tool = {
  name: "record_signals",
  description:
    "Record extracted LP allocation signals from this pension board document.",
  input_schema: {
    type: "object",
    properties: {
      signals: {
        type: "array",
        description:
          "All qualifying signals found in the document. Empty array if none.",
        items: {
          type: "object",
          properties: {
            type: {
              type: "integer",
              enum: [1, 2, 3],
              description:
                "1 = Commitment, 2 = Target allocation change, 3 = Pacing change.",
            },
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
              description:
                "Calibrated probability the signal is a true positive of the stated type.",
            },
            evidence_strength: {
              type: "integer",
              minimum: 0,
              maximum: 100,
              description:
                "Strength of textual evidence (specificity, approval proximity). Ignore plan size and recency — applied downstream.",
            },
            summary: { type: "string" },
            fields: {
              type: "object",
              description:
                "Type-specific fields. See the prompt for the exact keys required per signal type.",
            },
            source_page: { type: "integer", minimum: 1 },
            source_quote: {
              type: "string",
              description:
                "Verbatim quote from the document, max 30 words. Do not paraphrase.",
            },
          },
          required: [
            "type",
            "confidence",
            "evidence_strength",
            "summary",
            "fields",
            "source_page",
            "source_quote",
          ],
        },
      },
    },
    required: ["signals"],
  },
};
