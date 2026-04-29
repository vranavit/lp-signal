// IPS allocation classifier prompt (v1.0-ips).
//
// Sister prompt to ../prompts/cafr-allocation.ts. The CAFR prompt is
// asked to merge target % from the Notes Section with actual % from
// the Investment Section. The IPS prompt is simpler: there is one
// policy table and only target percentages live in it.
//
// IPS documents are short (typically 0.15-2.6 MB, 20-150 pages) and
// authoritative for *target* allocations. CAFRs disclose targets as a
// snapshot of the IPS in effect at fiscal year end; the IPS is the
// canonical source of truth.

export const IPS_PROMPT_VERSION = "v1.0-ips";

export function buildIpsPrompt(args: {
  planName: string;
  effectiveDateHint: string | null;
}): string {
  const dateLine = args.effectiveDateHint
    ? ` Document effective date hint: ${args.effectiveDateHint}.`
    : "";

  return `You are an expert pension fund analyst. Your job is to extract the target asset allocation table from a plan's Investment Policy Statement (IPS). Call the record_ips_allocations tool exactly once.

This document is from ${args.planName}.${dateLine} The plan name is already known — do not re-extract it.

**Scope.** Extract the plan-wide target asset allocation table — the table that defines, for each asset class, the target percentage of the total fund the plan intends to hold. Common headings:
- Asset Allocation Targets
- Strategic Asset Allocation
- Target Allocation Mix
- Target Asset Allocation
- Policy Target Allocation
- Investment Allocation Policy

For each asset class row in that table, emit one allocation entry.

**One table only.** IPS documents sometimes show multiple allocation tables — historical, transition (interim), long-term, or stress-tested. Extract the **current** target allocation only (the table that says "current," "in effect," "adopted," "approved" — or the most recent dated table). If multiple tables look equally current, prefer the one labeled "Strategic" or "Policy" over "Tactical" or "Interim". Note the choice in source_excerpt.

**Effective date.** If the IPS states when the current policy was adopted or revised (e.g. "Adopted: July 1, 2024", "Effective Date: November 15, 2024", "Last Amended: 2024-09-12"), emit it as effective_date in ISO 8601 YYYY-MM-DD form. If not stated, return effective_date = null. Do NOT use the IPS's "approved by board on" date if a separate "effective" date is given.

## Asset class rules

Standardize asset class names to the controlled enum: PE, Infra, Credit, RE, VC, Public Equity, Fixed Income, Cash, Other. Apply these mappings:

- "Private Equity," "Buyouts," "Growth Equity" → PE (with sub_class for sub-sleeves like "Buyout" / "Venture" / "Growth" only when the IPS lists distinct policy targets per sub-sleeve)
- "Infrastructure," "Infrastructure & Real Assets" (split if separable) → Infra
- "Private Credit," "Private Debt," "Direct Lending," "Mezzanine," "Distressed Debt" → Credit
- "Real Estate," "Real Property" → RE
- "Venture Capital," "VC" → VC
- "Public Equity," "Global Equity," "U.S. Equity," "International Equity," "Emerging Markets Equity," "Domestic Equity" → Public Equity (with sub_class when the IPS lists distinct policy targets per region)
- "Fixed Income," "Bonds," "Treasuries," "Investment Grade Credit," "TIPS," "High Yield" → Fixed Income (with sub_class when split)
- "Cash," "Cash Equivalents," "Liquidity," "Strategic Cash Overlay" → Cash
- "Hedge Funds," "Absolute Return," "Risk Mitigating Strategies," "Multi-Asset Class Strategies," "Trust Level," "Total Real Assets" (when not splittable into RE + Infra) → Other

If the IPS uses an asset class label you cannot confidently map to one of the nine canonical values (e.g. "Diversified Credit," "Inflation Protection"), emit as Other with sub_class set to the verbatim IPS label. Do NOT invent new top-level enum values.

## Granularity rules

- **Single undivided policy row:** emit one row, sub_class = null. Example: "Real Estate: 13%" → asset_class=RE, target_pct=13, sub_class=null.
- **Multiple policy targets within one asset class:** emit separate rows with sub_class populated. Example: under Public Equity, the IPS lists "Domestic 16%, International 13%, Emerging Markets 5%" → 3 rows, all asset_class=Public Equity, sub_class in {Domestic, International, Emerging Markets}.
- **Implementation strategies (NOT policy targets):** roll up. If the IPS describes how PE is implemented ("comprised of buyout funds, growth equity, and venture") without giving distinct policy targets per sub-strategy, emit one row at PE with sub_class=null.
- **Range only, no point target:** if the IPS provides only a permissible range (e.g. "Real Estate: 10-16%") without a single target, set target_pct to the range midpoint and populate target_min_pct / target_max_pct. Confidence ≤ 0.85 to reflect the imputation.

## NOISE — do NOT extract

- Historical allocation snapshots from prior policy versions.
- Implementation guidelines (rebalancing thresholds, manager concentration limits, leverage caps) — these belong to a future Day 4 / 5 prompt scope.
- Manager selection criteria (minimum AUM, track record requirements) — same.
- Pacing parameters (annual deployment ranges) — same.
- Performance benchmarks (e.g. "MSCI ACWI ex-US"). These are evaluation tools, not allocation targets.
- Risk-budget allocations expressed in basis points of tracking error rather than percentages of NAV.
- Asset class definitions and prose discussion — only emit rows that appear in the policy target TABLE.

## Hard guardrails (reject at emit-time)

- target_pct MUST be a specific number from the IPS. If the IPS doesn't list a specific target for an asset class, OMIT the row. Do NOT emit with target_pct = 0 to indicate absence.
- asset_class MUST be one of the nine enum values. If the IPS describes something out of scope (e.g. internal index allocations to MSCI/FTSE/S&P custom indexes), emit as Public Equity with sub_class describing the index.
- If the IPS does not contain a target asset allocation table at all (rare — should only happen if you've been given the wrong document), emit an empty target_allocations array.
- NULL is honest disposition. If you cannot determine effective_date, emit null. Never invent.

## Confidence calibration

- Specific target percentage in a clearly-labeled "Strategic Asset Allocation" or "Target Allocation" table: 0.92-1.00
- Specific target with a permissible range stated: 0.92-1.00 (high)
- Range only, midpoint imputed: 0.70-0.85 (preliminary)
- Asset class label requiring mapping (e.g. "Total Real Assets" → emit at Other): 0.75-0.85
- Inferred from prose ("the plan targets approximately 13% to private equity") rather than a table: 0.70-0.85

## Strict output rules

- Call record_ips_allocations exactly once with { "target_allocations": [...], "effective_date": ..., "source_excerpt": "..." }.
- Each row's source_quote is VERBATIM from the IPS, max 30 words. Interior omissions with "…" are allowed.
- Use null for optional fields when the document does not state them. Never invent values.
- One row per (asset_class, sub_class) pair — do not duplicate.`;
}
