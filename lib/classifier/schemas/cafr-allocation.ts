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

// Sonnet occasionally returns large dollar amounts as strings (e.g.
// "500000000000" or "$500B") despite the tool schema declaring integer.
// Accept either shape via a union; clean+parse the string variant.
// Treat the literal strings "null" / "none" / "" as null — Sonnet sometimes
// stringifies missing-value sentinels.
const isNullLike = (v: string): boolean =>
  /^\s*(null|none|n\/a|—|-)?\s*$/i.test(v);

const stringToIntOrNull = (min: number) =>
  z.string().transform((v, ctx) => {
    if (isNullLike(v)) return null;
    const cleaned = v.replace(/[^0-9.-]/g, "").trim();
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n < min) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `could not parse "${v}" as integer >= ${min}`,
      });
      return z.NEVER;
    }
    return Math.round(n);
  });

const coercedInt = z.union([
  z.number().int().nonnegative(),
  stringToIntOrNull(0),
]);

const coercedPositiveInt = z.union([
  z.number().int().positive(),
  stringToIntOrNull(1),
]);

const allocationSchema = z.object({
  asset_class: assetClassEnum,
  // v1.1-cafr: sub-sleeve label when the policy table distinguishes
  // policy targets inside a class (not when it lists implementation
  // sub-strategies like Buyout/Growth/Secondaries within PE).
  sub_class: z.string().min(1).max(120).nullable().optional(),
  target_pct: z.number().min(0).max(100),
  target_min_pct: z.number().min(0).max(100).nullable().optional(),
  target_max_pct: z.number().min(0).max(100).nullable().optional(),
  actual_pct: z.number().min(0).max(100).nullable().optional(),
  actual_usd: coercedInt.nullable().optional(),
  source_page: z.number().int().min(1),
  source_quote: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export const cafrAllocationResponseSchema = z.object({
  allocations: z.array(allocationSchema).default([]),
  total_plan_aum_usd: coercedPositiveInt.nullable().optional(),
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
                "Standardized asset class. Roll implementation sub-strategies up to the parent (e.g. buyout / venture / growth → PE; IG / HY → Fixed Income). When the policy table lists distinct *policy targets* inside a class (e.g. Domestic / International / Emerging Markets under Public Equity), emit separate rows with sub_class populated — see sub_class.",
            },
            sub_class: {
              type: "string",
              description:
                "Sub-sleeve label within asset_class, verbatim from the policy table, when the table gives multiple policy targets inside one asset class (e.g. 'Domestic' / 'International' / 'Emerging Markets' under Public Equity; 'Risk Mitigating Strategies' / 'Collaborative Strategies' under CalSTRS Other; 'TIPS' under Fixed Income). Null when the class is a single undivided policy row.",
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
