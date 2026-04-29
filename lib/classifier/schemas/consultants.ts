import { z } from "zod";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";

/**
 * Schema for v1.5-consultants classifier output.
 *
 * Extracts investment-consultant relationships from CAFR fee schedules.
 * Each entry represents one (firm, mandate) pairing for the document's
 * fiscal year, with the disclosed annual fee when available.
 *
 * Workstream 2 Phase A. Migration: 20260427000017_consultants.sql.
 */

// Mandate types this classifier can emit. Mirrors the CHECK constraint
// on plan_consultants.mandate_type. Note: the consultants table's
// default_specialties array also accepts "endowment_consulting" - that
// value is intentionally NOT here because plans don't have endowment-
// style mandates (default_specialties describes what a firm IS known
// for; mandate_type describes the per-plan engagement scope).
export const CONSULTANT_MANDATE_TYPES = [
  "general",
  "private_equity",
  "real_estate",
  "real_assets",
  "hedge_funds",
  "infrastructure",
  "fixed_income",
  "public_equity",
  "other",
] as const;

const mandateTypeEnum = z.enum(CONSULTANT_MANDATE_TYPES);

export const CONSULTANT_CONFIDENCE_TIERS = ["high", "medium", "low"] as const;
const confidenceEnum = z.enum(CONSULTANT_CONFIDENCE_TIERS);

// Period basis the disclosed fee_usd represents. Mirrors the CHECK
// constraint on plan_consultants.fee_period (added in
// 20260428235210_add_fee_period_to_plan_consultants.sql).
// 'annual'    = fiscal-year basis (default for ACFR/CAFR schedules)
// 'quarterly' = single-quarter accrual (board-meeting fee schedules)
// 'ytd'       = year-to-date cumulative (rare)
// 'monthly'   = monthly retainer (rare)
// null        = period not explicitly disclosed in source. NULL is the
//               honest disposition; the prompt instructs the classifier
//               to leave fee_period null rather than guess.
export const CONSULTANT_FEE_PERIODS = [
  "annual",
  "quarterly",
  "ytd",
  "monthly",
] as const;
const feePeriodEnum = z.enum(CONSULTANT_FEE_PERIODS);

// Sonnet sometimes returns numeric fields as strings ("$2,445" /
// "2445.00" / "null"). Mirror the cafr-allocation.ts coercion pattern.
const isNullLike = (v: string): boolean =>
  /^\s*(null|none|n\/a|—|-)?\s*$/i.test(v);

const stringToNumberOrNull = z.string().transform((v, ctx) => {
  if (isNullLike(v)) return null;
  const cleaned = v.replace(/[^0-9.-]/g, "").trim();
  const n = Number(cleaned);
  if (!Number.isFinite(n)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `could not parse "${v}" as number`,
    });
    return z.NEVER;
  }
  return n;
});

const stringToIntOrNull = z.string().transform((v, ctx) => {
  if (isNullLike(v)) return null;
  const cleaned = v.replace(/[^0-9-]/g, "").trim();
  const n = Number(cleaned);
  if (!Number.isFinite(n)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `could not parse "${v}" as integer`,
    });
    return z.NEVER;
  }
  return Math.round(n);
});

const consultantSchema = z.object({
  // Verbatim firm name as it appears in the document. Preserves casing,
  // punctuation, and legal suffixes ("Aksia, LLC" / "AKSIA CA, LLC").
  // The harness layer matches this against consultants.name_aliases.
  name_as_written: z.string().min(1).max(200),

  mandate_type: mandateTypeEnum,

  // Annual fee in absolute dollars. Classifier converts "(in thousands)"
  // / "$000s" disclosures by multiplying by 1000 before emitting. Null
  // when the fee is not disclosed in the source.
  //
  // Negative values are valid: CAFR fee schedules occasionally show
  // accrual reversals as parenthesized figures, e.g. "(511)" under
  // "Dollars in Thousands" -> fee_usd: -511000. Schema accepts any
  // real number; the prompt instructs the classifier when to emit
  // negative.
  fee_usd: z.union([z.number(), stringToNumberOrNull]).nullable(),

  // fee_year = calendar year of the fiscal-year-end the fee covers.
  // Examples:
  //   FY2024-2025 ending 2025-06-30 -> fee_year=2025
  //   FY2024 ending 2024-12-31      -> fee_year=2024
  //   FY2024 ending 2024-09-30      -> fee_year=2024
  // Same convention as as_of_date in pension_allocations.
  fee_year: z
    .union([z.number().int().min(2000).max(2030), stringToIntOrNull])
    .nullable(),

  // Period basis the captured fee_usd represents. See
  // CONSULTANT_FEE_PERIODS comment above. NULL is honest disposition
  // when source doesn't explicitly disclose the period.
  fee_period: feePeriodEnum.nullable(),

  // Verbatim window from the source confirming this entry. Used in the
  // /pensions/[slug] verification UI; should include the section heading
  // + firm name + fee number when all three are present.
  source_excerpt: z.string().min(10).max(500),

  // 1-indexed page number from the unpdf "=== Page N ===" marker.
  source_page: z.number().int().positive(),

  // high   = firm matches a master-list entry by canonical name or alias
  //          AND mandate_type is explicit from section heading.
  // medium = exactly one of: firm in master list, mandate explicit.
  // low    = firm extracted from generic "Professional Services" /
  //          "Consulting Fees" context; mandate inferred or "other".
  confidence: confidenceEnum,
});

export const consultantsResponseSchema = z.object({
  consultants: z.array(consultantSchema).default([]),
});

export type ConsultantExtraction = z.infer<typeof consultantSchema>;
export type ConsultantsResponse = z.infer<typeof consultantsResponseSchema>;

export const recordConsultantsToolSchema: Tool = {
  name: "record_consultants",
  description:
    "Record investment-consultant relationships extracted from this pension plan's CAFR fee schedule. Returns one entry per (firm, mandate) pairing. Empty array if the document does not list itemized consultants by firm name (e.g. only aggregated 'Investment Consulting Services: $X total' without firm names).",
  input_schema: {
    type: "object",
    properties: {
      consultants: {
        type: "array",
        description:
          "One entry per consultant relationship. Each row pairs a firm with a mandate scope and (when disclosed) the annual fee.",
        items: {
          type: "object",
          properties: {
            name_as_written: {
              type: "string",
              description:
                "Verbatim firm name as it appears in the document. Preserve casing, punctuation, legal suffixes (e.g. 'Aksia, LLC', 'AKSIA CA, LLC', 'Cambridge Associates LLC').",
            },
            mandate_type: {
              type: "string",
              enum: [...CONSULTANT_MANDATE_TYPES],
              description:
                "Mandate scope. Use 'general' for sections labeled 'Investment Consultant' / 'Investment Board Consultant' / 'General Consultant'. Use a specific mandate when the section explicitly labels it ('Real Estate Consultant Fees' -> 'real_estate'; 'Private Equity Consultant' -> 'private_equity'). When section is generic but firm has a known specialty (provided in master_list context), infer the most-likely mandate from default_specialties. Use 'other' only when no inference is possible.",
            },
            fee_usd: {
              type: ["number", "null"],
              description:
                "Annual fee paid to this consultant for this mandate, in absolute dollars. If the schedule states '(in thousands)' or '$000s', multiply the displayed value by 1000 before emitting (e.g. '$2,445' under 'Dollars in Thousands' -> 2445000). Negative values are valid: parenthesized figures like '(511)' indicate accrual reversals; emit as -511000 under 'Dollars in Thousands'. Null if fee is not disclosed.",
            },
            fee_year: {
              type: ["integer", "null"],
              minimum: 2000,
              maximum: 2030,
              description:
                "Calendar year of the fiscal-year-end the fee covers. FY ending 2025-06-30 -> 2025. FY ending 2024-12-31 -> 2024. FY ending 2024-09-30 -> 2024. Null if the fee is disclosed without a clear fiscal-year context.",
            },
            fee_period: {
              type: ["string", "null"],
              enum: [...CONSULTANT_FEE_PERIODS, null],
              description:
                "Period basis for fee_usd. 'annual' for fiscal-year disclosures (default for ACFR Schedule of Investment Expenses). 'quarterly' when the schedule footer explicitly says 'Total Quarterly Charges to Funds' or the section is a single-quarter accrual (board-meeting packets). 'ytd' for cumulative year-to-date schedules. 'monthly' for monthly retainers (rare). Null when the period basis is NOT explicitly disclosed in source text; never guess. NULL is honest disposition.",
            },
            source_excerpt: {
              type: "string",
              description:
                "Verbatim ~200 character window from the document confirming this entry. Include the section heading (e.g. 'Investment Consultant Fees'), the firm name as written, and the fee figure. Used in the verification UI.",
            },
            source_page: {
              type: "integer",
              minimum: 1,
              description:
                "Page number where this entry appears (1-indexed). Use the value from the '=== Page N ===' marker in the excerpt.",
            },
            confidence: {
              type: "string",
              enum: [...CONSULTANT_CONFIDENCE_TIERS],
              description:
                "high = firm matches master_list entry AND mandate is explicit from section heading. medium = exactly one of (firm in master_list, mandate explicit). low = firm extracted from generic 'Professional Services' / 'Consulting Fees' context; mandate inferred from default_specialties or set to 'other'.",
            },
          },
          required: [
            "name_as_written",
            "mandate_type",
            "fee_usd",
            "fee_year",
            "fee_period",
            "source_excerpt",
            "source_page",
            "confidence",
          ],
        },
      },
    },
    required: ["consultants"],
  },
};
