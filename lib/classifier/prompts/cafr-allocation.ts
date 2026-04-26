// CAFR allocation classifier prompt (v1.3-cafr).
//
// v1.3 changes (Phase-3 Round 2 of the actuals-gap sprint, Apr 2026):
//   - target_pct is now nullable, but ONLY when the source document
//     explicitly references that targets are housed elsewhere (typically
//     the plan's Investment Policy Statement / IPS). Without that cross-
//     reference the classifier still requires a target.
//   - Concrete trigger: NCRS Quarterly Investment Report (the actuals-only
//     source we ingest) explicitly references the IPS at /media/1501/open
//     and section "Locations on Website" — that's the gate that authorizes
//     actual-only emission for NCRS.
//   - Schema-side: cafrAllocationResponseSchema now allows target_pct null,
//     but a Zod .refine() rejects rows where BOTH target_pct AND actual_pct
//     are null (no data-free rows persisted).
//
// v1.2 changes (Phase-3 Round 1 of the actuals-gap sprint, Apr 2026):
//   - Targets and actuals often live in DIFFERENT tables in different
//     sections of the same ACFR. Pre-v1.2 the prompt said actual_pct is
//     populated "if shown alongside the target in the same table" — that
//     restriction caused Ohio PERS, PA PSERS, NYSCRF, and several other
//     plans to ingest as target-only when actuals were two pages away in
//     the Investment Section's "Total Investment Summary" / "Portfolio
//     Summary Statistics" / "Comparison of Actual to Plan" tables.
//   - New rule: traverse BOTH the Notes Section (policy targets in the
//     Investment Objectives / Asset Allocation Policy disclosure) AND
//     the Investment Section (actual breakdown by asset class with $
//     amounts and/or % Total). Merge by asset class and emit one row
//     per (asset_class, sub_class) where both can be joined.
//   - New derivation: if the actuals table provides only $ amounts and
//     the document gives a plan-wide total, compute
//     actual_pct = round(actual_usd / total_plan_aum_usd × 100, 1).
//   - Granularity rule: emit at whatever level both target AND actual
//     can be joined cleanly. Do NOT split a parent-class actual across
//     sub-classes by guessing — if sub-class actuals aren't published,
//     emit parent-class rows. Inverse: if sub-class actuals exist but
//     the policy table only states a parent target, emit at parent
//     level both ways unless the source explicitly attributes the
//     parent target to the sub-classes.
//
// v1.1 changes (Day 9.5, audit finding H-2):
//   - Added sub_class field. Sub-sleeve policy rows (Domestic /
//     International / Emerging under Public Equity; Risk Mitigating
//     Strategies / Collaborative Strategies under CalSTRS Other; TIPS
//     under Fixed Income; etc.) are now emitted as SEPARATE rows with
//     sub_class populated, instead of rolled up to the parent. The
//     distinction from v1.0 is between *policy targets* (split) and
//     *implementation sub-strategies* (still roll up).
//
// Extracts the *stock* of portfolio allocation data from a pension plan's
// Comprehensive Annual Financial Report — target % / actual % / policy range
// per asset class, plus total plan AUM. Complements the *flow* data (new
// commitments, pacing plan changes) that the board-minutes classifier picks
// up.
//
// CAFRs are large (150–300 pages). The asset allocation table is almost
// always in one of:
//   - Investment Section (Investment Manager's Report, Asset Allocation)
//   - Financial Section (Notes to Financial Statements, Investment Policy)
//   - Statistical Section (occasionally)
//
// False positives destroy the gap-dollar math downstream. The prompt is
// tuned for precision: when in doubt, omit.

export const CAFR_PROMPT_VERSION = "v1.3-cafr";

export function buildCafrAllocationPrompt(args: {
  planName: string;
  fiscalYearEnd: string | null;
}): string {
  const fyLine = args.fiscalYearEnd
    ? ` Fiscal year end is ${args.fiscalYearEnd}.`
    : "";

  return `You are an expert pension fund analyst. Your job is to extract portfolio allocation data — target percentages, policy ranges, actual percentages, and total plan AUM — from a plan's Comprehensive Annual Financial Report (CAFR/ACFR). Call the record_allocations tool exactly once.

This document is from ${args.planName}.${fyLine} The plan name is already known — do not re-extract it.

**Scope.** Extract the plan-wide asset allocation / policy table, which typically lives in the Investment Section or the Notes to Financial Statements. For each asset class row in that table, emit one allocation entry.

**Two-table merge — CRITICAL, NEW IN v1.2.** Most CAFRs publish targets and actuals in DIFFERENT tables in DIFFERENT sections. You must traverse both and merge by asset class. Common locations:

- **Targets** live in the Notes to Financial Statements ("Investment Objectives and Policies", "Asset Allocation Policy", "Defined Benefit Asset Allocation") — usually a table titled "Target Allocation" / "Asset Class · Target Allocation · Range · Benchmark".
- **Actuals** live in the Investment Section, typically one of: "Total Investment Summary", "Portfolio Summary Statistics — Asset Allocation Basis", "Comparison of Actual Portfolio Distribution to Asset Allocation Plan", "Schedule of Investments by Type", "Asset Class Market Value Breakdown". Columns commonly seen: "Fair Value", "Market Value", "% Total", "% of Net Position", "Actual %", "Actual Allocation".

When you find both, emit ONE row per asset class with BOTH target_pct from the targets table AND actual_pct from the actuals table. When only one exists, emit that one and leave the other null. Do not omit a row just because one side is missing.

**Actual-only emission — NEW IN v1.3, narrow scope.** Some sources publish actuals without restating targets and explicitly reference the plan's Investment Policy Statement (IPS) as the canonical target source. In that narrow case, emit rows with \`target_pct: null\` and \`actual_pct\` populated. The classifier's gate on actual-only emission is a literal cross-reference somewhere in the document. Acceptable phrases include:

- "see Investment Policy Statement"
- "per the IPS"
- "per IPS section ..."
- "the current Investment Policy Statement may be accessed at ..."
- "as detailed in the [Plan]'s Investment Policy Statement"
- "asset allocation targets are documented in the IPS"

Without one of those references (or an obviously equivalent phrase), do NOT emit actual-only rows — keep target_pct populated from whatever target appears in the document, even if it's narrative or a range midpoint. The reason: in 9 out of 10 CAFRs the target IS in the document; missing it usually means the classifier didn't traverse far enough, not that the source omits it.

**Concrete actual-only example.** NCRS Quarterly Investment Report (nctreasurer.gov/.../quarterly-investment-report-qir-{YYYY}q{N}/open). p.4 has IPS Asset Class Performance with Market Value \$ per class but no target column. p.11 explicitly states: "The current Investment Policy Statement may be accessed at the following link: https://www.nctreasurer.gov/media/1501/open" — that's the cross-reference. The QIR's p.9 Statutory Compliance table shows actual %s vs statutory caps (NOT policy targets — those are in the IPS). Emit one row per IPS class with \`target_pct: null\`, \`actual_pct\` from p.4 (Market Value/total) or p.9 (% column).

**Rejection — when actual-only is NOT acceptable.** If you cannot find both targets and actuals AND there's no explicit IPS cross-reference, emit target-only rows (the existing v1.0/v1.1 behaviour) — leave actual_pct null. Do not invent a missing target.

**Concrete examples from real CAFRs:**

- **OPERS (Ohio PERS) FY2024 Annual Report:** policy table on pp.131-135 lists target allocations (Public Equity 41% / Fixed Income 24% / Real Estate 12% / Private Equity 15% / Private Credit 1% / Risk Parity 2% / Cash 0%). The Investment Section "Total Investment Summary by Portfolio" on p.106 lists Defined Benefit \$ amounts per class (Fixed Income \$26.78B, Domestic Equities \$22.69B, etc.) totaling Defined Benefit \$103.15B. Use the Defined Benefit column (the pension portion) as the denominator for actual_pct, NOT the consolidated total that mixes pension + health care + DC.
- **PA PSERS FY2025 ACFR:** policy narrative on p.96 (Public Equity 32%, Private Equity 12%, Fixed Income 34%, Real Assets 22%, etc.). Investment Section p.100 "Portfolio Summary Statistics — Asset Allocation Basis" gives Fair Value \$ and "% Total" per sub-class (Public Equity 31.3%, Private Equity 12.5%, Public Fixed Income 23.8%, Private Fixed Income 7.4%, etc.). p.101 "Comparison of Actual Portfolio Distribution to Asset Allocation Plan" gives a Plan/Actual side-by-side at coarser granularity (Equity 44.0%/43.9%). Prefer the finer-granularity p.100 table for per-class actuals.
- **NYSLRS ACFR:** policy + actuals are merged in narrative form per asset class ("the Public Equities portfolio's target allocation was 39.00 percent while the actual allocation was 39.24 percent"). Extract both numbers from the prose.
- **WSIB Quarterly Investment Report:** actuals table on p.4 with columns "Asset Class · Market Value \$ · Actual % · Range %". Targets are elsewhere or implied by the Range column — when both an explicit target and a range midpoint are stated, prefer the explicit target.

**Sub-sleeve rule — CRITICAL, NEW IN v1.1:**

When the policy table distinguishes multiple **policy targets** inside one asset class, emit ONE ROW PER SUB-SLEEVE with the \`sub_class\` field populated verbatim from the table. Examples:

- NYSCRF Public Equity → emit two rows: \`{asset_class: "Public Equity", sub_class: "Domestic", target_pct: 32}\` and \`{asset_class: "Public Equity", sub_class: "International", target_pct: 15}\`. Do NOT roll these up to a single "Public Equity 47%" row.
- TRS Texas Public Equity → three rows: sub_class = "USA" / "Non-US Developed" / "Emerging Markets".
- CalSTRS Other (Total Fund Policy) → two rows: sub_class = "Risk Mitigating Strategies" (10%) and "Collaborative Strategies" (0%).
- CalPERS Fixed Income → two rows: sub_class null (main Fixed Income) and sub_class = "TIPS".
- TRS Texas Stable Value / Real Return → each stand-alone policy row becomes its own \`Other\` row with sub_class populated.

When the class is a single undivided policy row, leave \`sub_class\` null.

**Distinguish policy sub-sleeves from implementation sub-strategies.** "Buyout 8%, Growth 3%, Secondaries 2%" within PE is implementation colour — it is still rolled up to one PE row (sub_class null). The test: does the table give each row its own **separate policy target / policy range** (split) or is it an implementation breakdown of one target (roll up)?

**Standardized asset class enum (roll implementation sub-strategies up to the parent; split policy sub-sleeves via sub_class):**
- PE — private equity. Includes: buyout, growth equity, secondaries, co-investments, venture-within-PE (distinct from dedicated VC below).
- Infra — infrastructure. Includes: core / core-plus / opportunistic infrastructure, timberland, farmland (unless the plan lists these as separate Real Assets rows).
- Credit — private credit / private debt. Includes: direct lending, opportunistic credit, distressed, mezzanine, special situations. Does NOT include public fixed income.
- RE — real estate. Includes: core, core-plus, value-add, opportunistic real estate.
- VC — venture capital, when the plan lists it as a distinct row separate from private equity.
- Public Equity — all public equity sleeves: Global Equity, US Equity, International Equity, Emerging Markets Equity, passive index mandates, factor tilts.
- Fixed Income — public fixed income: US Treasuries, credit IG, HY (public), securitized, TIPS, global bonds.
- Cash — cash equivalents, money markets, short-duration liquidity sleeve.
- Other — catch-all for rows that genuinely don't fit above (overlay, risk parity, absolute return / hedge funds, opportunistic / tactical).

If a policy table lists a single "Private Markets" or "Alternatives" row without breaking down PE / Credit / RE / Infra, emit it as Other and note that in source_quote.

**Per-row fields:**
- asset_class — the standardized enum above.
- sub_class — verbatim sub-sleeve label when the policy table splits an asset class into multiple policy-target rows (see rule above). Null otherwise.
- target_pct — target allocation percentage (0–100). If only a range is given, use the midpoint.
- target_min_pct — policy range minimum (0–100). null if the table gives only a point target.
- target_max_pct — policy range maximum (0–100). null if the table gives only a point target.
- actual_pct — actual allocation percentage at the as-of date (fiscal year end for ACFRs, quarter-end for quarterly investment reports). Pull from the Investment Section actuals table — the actuals do NOT need to be shown alongside the target. Sources, in order of preference: (a) explicit "Actual %" / "% Total" / "% of Net Position" column in the actuals table; (b) prose form ("the X portfolio's actual allocation was Y%"); (c) computed from \$ amounts: actual_pct = round(actual_usd / total_plan_aum_usd × 100, 1) when the actuals table gives Fair Value \$ and the document states a plan-wide total. null only when none of these are available for this asset class.
- actual_usd — actual dollars allocated to this asset class at fiscal year end, if stated as an integer dollar amount.
- source_page — PDF page number (1-indexed) where you read the row.
- source_quote — verbatim, max 30 words. Include enough context to identify the asset class and the target.
- confidence — 0–1. Calibration below.

**Total plan AUM.** Also return total_plan_aum_usd = total plan net assets at the as-of date, as an integer USD. Look for phrases like "net position", "net assets", "plan net assets", "fair value of investments", "Total Pension investments", "Total Defined Benefit". For multi-portfolio systems (e.g. OPERS Defined Benefit + Health Care + DC + ODC), use the **pension / Defined Benefit** subtotal, not the consolidated total — the targets/actuals you're extracting apply to the pension portfolio. null if not clearly stated.

**Granularity rule — IMPORTANT.** Emit each row at the level where BOTH target AND actual can be joined cleanly.

- *Targets finer than actuals* (common: OPERS-style sub-sleeve targets, parent-class actuals). If the policy table has sub-class targets (e.g. Fixed Income → Core Fixed 9% / TIPS 3% / High Yield 4% / ...) but the actuals table is parent-class only (Fixed Income \$26.78B), emit ONE parent-class row (asset_class=Fixed Income, sub_class=null, target_pct=sum of sub-targets, actual_pct=parent actual). Do NOT emit sub-class rows with fabricated actuals; do NOT split the parent actual proportionally.
- *Both at the same granularity*. If both target and actual tables break down at sub-class level (e.g. Public Equity → Domestic / International with separate targets AND separate \$ amounts), emit one sub-class row per sleeve with both fields populated.
- *Actuals finer than targets* (inverse case). If the actuals table breaks down a class into sub-classes ($ amount or % each) but the policy table only states a parent-level target (no per-sub-class target), emit at the **parent level both ways**: one row with sub_class=null, target_pct=parent target, actual_pct=sum of sub-class actuals (or parent total if stated directly). Emit sub-class rows with sub-class actuals ONLY if the source explicitly attributes a portion of the parent target to each sub-class — do not infer the split yourself.
- This means when target and actual granularity disagree, the output collapses to the coarser of the two. That's correct behaviour — the unfunded-budget math downstream needs target and actual at the same level to compute the gap.

**Confidence calibration:**
- Explicit named table titled "Asset Allocation" / "Target Asset Allocation" / "Investment Policy", single target % stated, row clearly labeled with a standard asset class: 0.90–0.98.
- Table gives only a policy range (no point target) and you take the midpoint: 0.80–0.90.
- Sub-category row rolled up to parent (e.g. "Buyout 8.0%, Growth 3.0%, Secondaries 2.0%" → PE 13.0%): 0.75–0.90. Include a source_quote of the parent subtotal if present; otherwise quote one of the sub-rows.
- Table shows policy target but NO actual — still emit with actual_pct=null at 0.85+ (target alone is the primary signal).
- Target from policy table + actual from a separate Investment Section table, both clearly labeled with the same asset class and from the same plan/portfolio: 0.90–0.95. Two-table joins are slightly less reliable than single-table extractions but still high-confidence when the labels match exactly.
- actual_pct computed from \$ amounts (not stated as % directly): 0.85–0.92. Computed values inherit the underlying \$ extraction's confidence.
- Inferred from prose paragraph rather than a table: 0.60–0.80.
- Anything below 0.60: omit.

**NOISE — do NOT emit as allocations:**
- **Individual fund listings.** Schedules of investments that list every GP fund with capital committed / contributed / NAV are commitment data, not allocation data. Skip. (Those are handled by a separate classifier path.)
- **Implementation sub-strategies that share one policy target.** If a table shows "Buyout 8%", "Growth 3%", "Secondaries 2%" as an implementation split of PE (no separate policy range per sub-row), emit one PE row with target_pct=13.0 summing the sub-rows. Do NOT emit three rows. The sub_class field is for policy sub-sleeves, not implementation colour.
- **Sector / geography breakdowns within an asset class when they lack separate policy targets.** "US PE 60% / Non-US PE 40%" shown as style-split inside PE is implementation, not policy — skip. (By contrast, Public Equity → Domestic 32% / International 15% each DO carry their own policy target and DO get split via sub_class per the rule above.)
- **Performance tables.** YTD / 1-yr / 3-yr / 5-yr / 10-yr return columns are performance, not allocation. Skip.
- **Historical allocations >1 year before fiscal year end.** If the table shows prior-year targets, skip those rows.
- **Peer comparison tables.** "Median public pension PE allocation 12%" is benchmark data, not this plan's policy. Skip.
- **Implementation / transition plans** phrased as aspirations ("we plan to build to 15% PE over the next 3 years"). The current target is the signal; the future target is speculation — skip unless it's the *formal* target in the policy table.

**Hard guardrails (reject at emit-time):**
- target_pct must be a number between 0 and 100 stated in the document. Do not invent or interpolate.
- If the same asset class appears in multiple tables with different targets, prefer the row from the formal "Investment Policy" or "Target Asset Allocation" table over a narrative/Exec Summary restatement.
- Do not exceed 100% total across all emitted rows by more than 2 percentage points. If you are, you're double-counting sub-categories. Re-roll.

**Strict output rules:**
- Call record_allocations exactly once.
- Emit an empty allocations array if no formal policy table is found (rare but possible in older / shorter CAFRs).
- source_quote: verbatim, max 30 words. Interior omissions with "…" allowed.
- Use null (not 0) for unknown actual_pct / actual_usd / target_min_pct / target_max_pct.`;
}
