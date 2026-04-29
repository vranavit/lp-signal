import { z } from "zod";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { ALLOCATION_ASSET_CLASSES } from "./cafr-allocation";

/**
 * IPS allocation extraction schema. Sister to ./cafr-allocation.ts but
 * scoped to the policy-targets portion only (an IPS does not disclose
 * actuals — those live in CAFRs and quarterly reports).
 *
 * Reuses the same asset-class enum so IPS-derived rows in
 * pension_allocations are comparable to CAFR-derived rows.
 */

const assetClassEnum = z.enum(ALLOCATION_ASSET_CLASSES);

const ipsAllocationSchema = z.object({
  asset_class: assetClassEnum,
  sub_class: z.string().min(1).max(120).nullable().optional(),
  // Allocation percentages can be negative for cash/leverage offset rows.
  target_pct: z.number().min(-100).max(100),
  target_min_pct: z.number().min(-100).max(100).nullable().optional(),
  target_max_pct: z.number().min(-100).max(100).nullable().optional(),
  source_quote: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export const ipsResponseSchema = z.object({
  target_allocations: z.array(ipsAllocationSchema).default([]),
  // ISO 8601 YYYY-MM-DD when stated. Null when the document does not
  // cite an effective date — caller falls back to documents.created_at.
  effective_date: z.string().nullable().optional(),
  // 30-50 word excerpt locating the allocation table.
  source_excerpt: z.string().nullable().optional(),
});

export type IpsAllocation = z.infer<typeof ipsAllocationSchema>;
export type IpsResponse = z.infer<typeof ipsResponseSchema>;

export const recordIpsAllocationsToolSchema: Tool = {
  name: "record_ips_allocations",
  description:
    "Record extracted target asset allocation data from this plan's Investment Policy Statement. One entry per asset class row in the policy target table, plus the IPS effective date if stated.",
  input_schema: {
    type: "object",
    properties: {
      target_allocations: {
        type: "array",
        description:
          "One entry per asset class row in the policy target table. Empty array if no such table is found.",
        items: {
          type: "object",
          properties: {
            asset_class: {
              type: "string",
              enum: [...ALLOCATION_ASSET_CLASSES],
              description:
                "Standardized asset class. Roll implementation sub-strategies up to the parent (e.g. buyout / venture / growth → PE; IG / HY → Fixed Income). When the IPS lists distinct policy targets inside a class (e.g. Domestic / International / Emerging Markets under Public Equity), emit separate rows with sub_class populated.",
            },
            sub_class: {
              type: "string",
              description:
                "Sub-sleeve label within asset_class, verbatim from the policy table, when the table gives multiple policy targets inside one asset class. Null when the class is a single undivided policy row.",
            },
            target_pct: {
              type: "number",
              minimum: -100,
              maximum: 100,
              description:
                "Target allocation percentage (typically 0-100; may be negative for leverage-offset rows). REQUIRED — if a specific target is not stated, omit the row entirely. Do NOT emit with placeholder values like 0 when the policy table simply doesn't list this asset class.",
            },
            target_min_pct: {
              type: "number",
              minimum: -100,
              maximum: 100,
              description:
                "Policy range minimum, if a permissible range is stated. null otherwise.",
            },
            target_max_pct: {
              type: "number",
              minimum: -100,
              maximum: 100,
              description:
                "Policy range maximum, if a permissible range is stated. null otherwise.",
            },
            source_quote: {
              type: "string",
              description:
                "Verbatim quote from the IPS, max 30 words. Anchors the row to text the auditor can find.",
            },
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
              description:
                "Calibrated probability the row is a faithful extraction of the IPS's stated policy target.",
            },
          },
          required: [
            "asset_class",
            "target_pct",
            "source_quote",
            "confidence",
          ],
        },
      },
      effective_date: {
        type: "string",
        description:
          "ISO 8601 YYYY-MM-DD if the IPS states an effective / adoption / revision date for the current policy. Null if not stated.",
      },
      source_excerpt: {
        type: "string",
        description:
          "30-50 word excerpt locating the allocation table inside the IPS, e.g. the section heading and the first one or two rows verbatim.",
      },
    },
    required: ["target_allocations"],
  },
};
