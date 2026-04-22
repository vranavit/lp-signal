import { z } from "zod";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";

// Asset class enum for CAFR allocation extraction. Broader than the
// private-markets-only signals enum because CAFR policy tables cover the
// full plan (public equity, fixed income, cash, etc.). The "gap" visualisation
// on the pension profile page uses all of these.
export const ALLOCATION_ASSET_CLASSES = [
  "PE",
  "Infra",
  "Credit",
  "RE",
  "VC",
  "Public Equity",
  "Fixed Income",
  "Cash",
  "Other",
] as const;

const assetClassEnum = z.enum(ALLOCATION_ASSET_CLASSES);

const allocationSchema = z.object({
  asset_class: assetClassEnum,
  target_pct: z.number().min(0).max(100),
  target_min_pct: z.number().min(0).max(100).nullable().optional(),
  target_max_pct: z.number().min(0).max(100).nullable().optional(),
  actual_pct: z.number().min(0).max(100).nullable().optional(),
  actual_usd: z.number().int().nonnegative().nullable().optional(),
  source_page: z.number().int().min(1),
  source_quote: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export const cafrAllocationResponseSchema = z.object({
  allocations: z.array(allocationSchema).default([]),
  total_plan_aum_usd: z.number().int().positive().nullable().optional(),
});

export type CafrAllocation = z.infer<typeof allocationSchema>;
export type CafrAllocationResponse = z.infer<typeof cafrAllocationResponseSchema>;

export const recordAllocationsToolSchema: Tool = {
  name: "record_allocations",
  description:
    "Record extracted portfolio allocation data from this pension plan's CAFR. Returns one entry per asset class row in the policy / asset allocation table, plus the total plan AUM.",
  input_schema: {
    type: "object",
    properties: {
      allocations: {
        type: "array",
        description:
          "One entry per asset class row in the asset allocation / target policy table. Empty array if no such table is found.",
        items: {
          type: "object",
          properties: {
            asset_class: {
              type: "string",
              enum: [...ALLOCATION_ASSET_CLASSES],
              description:
                "Standardized asset class. Roll sub-categories up to the parent (e.g. buyout / venture / growth → PE; IG / HY → Fixed Income).",
            },
            target_pct: {
              type: "number",
              minimum: 0,
              maximum: 100,
              description:
                "Target allocation percentage (0-100). If only a range is given, use the midpoint.",
            },
            target_min_pct: {
              type: "number",
              minimum: 0,
              maximum: 100,
              description: "Policy range minimum, if stated. null otherwise.",
            },
            target_max_pct: {
              type: "number",
              minimum: 0,
              maximum: 100,
              description: "Policy range maximum, if stated. null otherwise.",
            },
            actual_pct: {
              type: "number",
              minimum: 0,
              maximum: 100,
              description:
                "Actual allocation as of the fiscal year end, if shown alongside the target.",
            },
            actual_usd: {
              type: "integer",
              minimum: 0,
              description:
                "Actual dollars allocated to this asset class at fiscal year end, if stated.",
            },
            source_page: { type: "integer", minimum: 1 },
            source_quote: {
              type: "string",
              description: "Verbatim, max 30 words.",
            },
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
          },
          required: [
            "asset_class",
            "target_pct",
            "source_page",
            "source_quote",
            "confidence",
          ],
        },
      },
      total_plan_aum_usd: {
        type: "integer",
        minimum: 0,
        description:
          "Total plan net assets / AUM at the fiscal year end reported by this CAFR, in USD. null if not clearly stated.",
      },
    },
    required: ["allocations"],
  },
};
