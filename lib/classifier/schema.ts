import { z } from "zod";

export const ASSET_CLASSES = [
  "PE",
  "Infra",
  "Credit",
  "RE",
  "VC",
  "Other",
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
] as const;

const approvalTypeEnum = z.enum(APPROVAL_TYPES);

const t1Fields = z.object({
  gp: z.string().min(1),
  fund_name: z.string().min(1),
  amount_usd: z.number().int().nonnegative(),
  asset_class: assetClassEnum,
  approval_date: z.string().nullable().optional(),
  approval_type: approvalTypeEnum,
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

export const classifierResponseSchema = z.object({
  signals: z.array(signalSchema),
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
