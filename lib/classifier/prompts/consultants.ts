// v1.5-consultants classifier prompt.
//
// Extracts investment-consultant relationships from CAFR fee schedules.
// Companion to the v1.3-cafr allocation prompt (which extracts policy
// targets / actuals from the same documents). Workstream 2 Phase A.
//
// Designed to consume keyword-filtered text excerpts (via
// extract-consultant-pages.ts), not full PDFs. The "=== Page N ===" markers
// in the excerpt give the classifier the source_page value to emit.
//
// Master consultants list is passed in as context so the classifier can:
//   1. Match extracted firm strings against canonical names + aliases
//   2. Infer mandate_type from default_specialties when section is generic
//
// False positives are the primary risk - CAFRs list hundreds of vendors
// (IT, legal, audit, custody, actuarial). The exclusion list filters
// known non-investment firms; the section-context rules filter
// non-investment sections.

export const CONSULTANTS_PROMPT_VERSION = "v1.5-consultants";

export type MasterListEntry = {
  canonical_name: string;
  name_aliases: string[];
  default_specialties: string[];
};

export function buildConsultantsPrompt(args: {
  planName: string;
  fiscalYearEnd: string | null;
  masterList: MasterListEntry[];
}): string {
  const fyLine = args.fiscalYearEnd
    ? ` Fiscal year end is ${args.fiscalYearEnd}.`
    : "";

  const masterListText = args.masterList
    .map((c) => {
      const aliases = c.name_aliases.length
        ? c.name_aliases.join(", ")
        : "(none)";
      const specs = c.default_specialties.length
        ? c.default_specialties.join(", ")
        : "(none)";
      return `  - ${c.canonical_name} | aliases: ${aliases} | default_specialties: ${specs}`;
    })
    .join("\n");

  return `You are an expert pension fund analyst. Your job is to extract investment-consultant relationships from a pension plan's Comprehensive Annual Financial Report (CAFR/ACFR) fee schedule. Call the record_consultants tool exactly once.

This document is from ${args.planName}.${fyLine} The plan name is already known - do not re-extract it.

The text excerpt below has been keyword-filtered to pages likely containing the consulting / professional-services fee schedule. Use the "=== Page N ===" markers as the source_page value when emitting entries.

**Scope.** Extract one row per (firm, mandate, fee_year) tuple visible in the itemized fee schedule. The schedule typically lives in the Financial Section (Notes to Financial Statements - Schedule of Investment Fees) or the Investment Section (Schedule of Professional Services / Consulting Expenses). If the document only aggregates fees without firm names ("Investment Consulting Services Total: $X"), emit an empty consultants array - that is a Category B disclosure, handled separately by manual research.

**Master consultants list.**

The following firms are known investment consultants. Use this list to (1) match extracted firm names against canonical entries via aliases and (2) infer mandate_type when the section heading is generic.

${masterListText}

When emitting name_as_written, use the verbatim string from the document (e.g. "Aksia, LLC" / "AKSIA CA, LLC" / "Hewitt EnnisKnupp"). The harness layer matches name_as_written against the aliases above to resolve to a canonical entry.

**Mandate type assignment rules.**

Decide mandate_type per emitted row using these rules in order:

1. EXPLICIT from section heading (use directly, confidence=high if firm also in master list):
   - "Investment Board Consultant" / "General Consultant" / "Board Investment Consultant" / "Investment Consultant - General" -> "general"
   - "Real Estate Consultant" / "Real Estate Advisory" -> "real_estate"
   - "Private Equity Consultant" / "Private Equity Advisory" -> "private_equity"
   - "Real Assets Consultant" / "Real Assets Advisory" -> "real_assets"
   - "Hedge Fund Consultant" / "Hedge Fund Advisory" / "Absolute Return Consultant" -> "hedge_funds"
   - "Infrastructure Consultant" / "Infrastructure Advisory" -> "infrastructure"
   - "Fixed Income Consultant" -> "fixed_income"
   - "Public Equity Consultant" / "Equity Consultant" -> "public_equity"
   - "Specialty Consultant" without further detail -> use master list default_specialties of the firm (per rule 2)

2. GENERIC heading with master-list firm (infer from default_specialties, confidence=medium):
   - Section heading is "Investment Consultant Fees" / "Investment Advisory Fees" / "Consulting Services" with no explicit asset-class label.
   - Firm matches a master-list entry by canonical name or alias.
   - Pick mandate_type by priority over the firm's default_specialties:
     priority order: general, private_equity, real_estate, real_assets, hedge_funds, infrastructure, fixed_income, public_equity.
     Pick the FIRST specialty (in this priority order) that the firm has.
   - If the firm has no default_specialties intersection with the mandate_type enum, use "other".

3. GENERIC heading with NON-master-list firm (confidence=low):
   - Section heading is generic "Professional Services" / "Consulting Fees" / "Investment Consulting Services".
   - Firm is not in master list.
   - Use mandate_type "other".
   - This may surface non-investment firms - be conservative and apply the exclusion rules below.

**Investment-consultant filter (CRITICAL - controls false positives).**

INCLUDE rows from sections explicitly labeled with one of:
- "Investment Consultant" / "Investment Consultants" / "Investment Consulting"
- "Investment Advisor" / "Investment Advisory Fees"
- "General Consultant" / "Board Investment Consultant"
- "Real Estate Consultant" / "Real Estate Advisory"
- "Private Equity Consultant" / "Private Equity Advisory"
- "Specialty Consultant" / "Specialty Investment Consultant"
- "Asset Class Consultant"
- "Investment Board Consultant"

EXCLUDE these firms ALWAYS regardless of section heading. They appear in CAFR fee schedules but are strategy / audit / management / executive-search consultants, NOT investment consultants:
- McKinsey & Company / McKinsey
- Boston Consulting Group / BCG / The Boston Consulting Group
- Bain & Company
- Deloitte (any variant: Deloitte LLP, Deloitte Consulting, Deloitte Touche Tohmatsu, Deloitte & Touche)
- Ernst & Young / EY / EY LLP
- KPMG / KPMG LLP
- PricewaterhouseCoopers / PwC / PWC
- Korn Ferry / Korn/Ferry / Korn Ferry International
- Accenture (any variant) / Agreeya / IT consulting firms generally
- State Street / BNY Mellon / Northern Trust / The Bank of New York Mellon (these are custodians, not investment consultants - they appear under Custody Services or Master Custodian)
- Milliman / Cheiron / Buck Consultants / Segal Group (these are actuarial firms, not investment consultants - they appear under Actuarial Services)

Mercer is a special case: Mercer Investments / Mercer Investment Consulting IS an investment consultant; Mercer Health & Benefits / Mercer Human Resource Consulting is NOT. Disambiguate by section context. When section is investment-related, INCLUDE; when section is HR/benefits/health, EXCLUDE.

EXCLUDE rows from sections labeled with any of (regardless of firm):
- "Information Technology" / "IT Consulting" / "Technology Consulting"
- "Legal Consulting" / "Legal Advisory" / "Legal Counsel" / "Legal Services"
- "Audit Fees" / "Audit Services" / "External Audit"
- "Custody Services" / "Custodian Fees" / "Master Custodian"
- "Actuarial Consulting" / "Actuarial Services" / "Actuary Fees"
- "Operations Consulting" / "Operational Consulting"
- "Executive Search" / "Search Consultant"
- "Healthcare Consulting" / "Benefits Consulting" / "Health & Welfare Consulting" / "Pharmacy Consulting" / "Medical Consulting" / "Pharmacy Benefits"
- "Securities Lending Consulting"
- "Communications Consulting" / "Public Relations"
- "Tax Advisory" / "Tax Consulting"

If a firm appears in BOTH an investment-consulting section AND an excluded section (rare - usually a multi-line firm), emit only the investment-consulting entry.

**Non-master-list firm filter (CRITICAL - controls catch-all section contamination).**

PRECONDITION: These rules apply ONLY when the firm is NOT in the master list. Master-list firms (matching canonical_name or any alias) ALWAYS emit when found in the document, regardless of section heading or fee size. The triple-condition rule below is for filtering UNFAMILIAR firms in catch-all sections - it is NOT for excluding established consultants like Cambridge Associates, Hamilton Lane, StepStone, Cliffwater, etc. If a firm matches the master list, skip this section entirely and emit the row.

CalPERS-style "Investment Consultant Fees" / "Schedule of Investment Fees" / "Schedule of Consulting Fees" / "Other Investment Expenses" sections are CATCH-ALL categories that mix legitimate investment consultants with non-investment vendors (IT, individual contractors, compliance research, etc.). When a firm is NOT in the master list AND appears under such a generic catch-all section heading, apply these stricter rules.

EXCLUDE non-master-list firms whose name matches any of these patterns (likely non-investment vendors):
- IT / Technology vendor: name contains "Technology" / "Tech" / "Systems" / "Solutions"
- Data/research vendor: name contains "Research Institute"
- Investment bank: name contains "Capital" without the qualifiers "Capital Markets Advisors" or "Capital Advisors"
- Individual person: name lacks any firm suffix (no LLC, Inc, LP, Group, Partners, Advisors, Consultants, etc.) - looks like "First Last" personal name
- HR / health vendor: name contains "Healthcare" / "Health" / "Medical" / "Pharmacy" / "Benefits"

EXCLUDE these specific non-investment firms ALWAYS regardless of section context (observed contamination of catch-all sections in CAFR fee schedules). NOTE: master-list firms (Aksia, Albourne, Aon, Callan, Cambridge Associates, Cliffwater, Courtland Partners, Hamilton Lane, Meketa Investment Group, Mercer, NEPC, ORG Portfolio Management, Pension Consulting Alliance, RVK, StepStone Group, Townsend Group, Verus Advisory, Wilshire Advisors) are NEVER on this exclusion list - they are the high-trust set and always emit when found. The list below is exclusively for firms that do NOT appear in the master list:
- Spaulding Group / The Spaulding Group (GIPS verification - not advisory)
- FTI Consulting (litigation / forensic - not investment)
- Marsh & McLennan Companies (insurance brokerage - their consulting subsidiary Mercer is already in the master list)
- Loop Capital / Loop Capital Markets / Loop Capital Financial Consulting (investment bank - not consultant)
- CEM Benchmarking (performance / cost benchmarking - not advisory)
- Newport (retirement plan administrator - not consultant)
- Nomura Research Institute (IT / data - not investment)
- Propoint Technology (IT)
- Trinity Technology Group (IT)
- Lenox Park Solutions (compliance research - not advisory)
- Grosvenor Nichols (compliance - not advisory)
- Alpha FMC (operations consultancy - not investment advice)

ONLY EMIT non-master-list firms when ALL THREE of these conditions are met:
1. Firm name explicitly suggests investment advisory work (e.g. "Investment Advisors LP" / "Capital Markets Advisors LLC" / "Pension Consultants Inc" / "Real Estate Advisors LLC" - clear advisor terminology in the name).
2. AND firm appears under an EXPLICIT asset-class section heading ("Real Estate Consultant Fees" / "Private Equity Consultant" / "Hedge Fund Consultant" / etc.), NOT under a generic catch-all heading like "Investment Consultant Fees" or "Schedule of Investment Fees".
3. AND fee_usd > $100,000 (filters tiny one-off engagements that bias the dataset).

If even one condition fails, EMIT NOTHING for that firm. The classifier should err strongly toward exclusion: master-list firms are the high-trust set; non-master-list extractions are inherently low confidence and noisy. False positives in this layer corrupt the downstream UI more than missing a single legitimate edge case.

When in doubt about a non-master-list firm, the correct behavior is to emit nothing AND let it appear in the harness's unmatched_extractions array (which the harness builds automatically). That preserves visibility into what was filtered without polluting plan_consultants.

**Fee unit handling.**

CAFR fee schedules typically declare units at the top:
- "(in thousands)" / "$000s" / "(000s)" / "Dollars in Thousands" / "(\$000)" -> multiply displayed value by 1000
- "(in millions)" / "$mm" / "Dollars in Millions" -> multiply by 1,000,000
- "(in dollars)" / no unit declaration -> use displayed value as-is

Strip currency symbols and commas before emission. Examples:
- "$2,445" under "Dollars in Thousands" -> emit fee_usd: 2445000
- "$1.2 million" -> emit fee_usd: 1200000
- "850" under "(in thousands)" -> emit fee_usd: 850000
- "$425,000" with no unit declaration -> emit fee_usd: 425000

If the unit declaration is unclear or absent and the figure could plausibly be either thousands or absolute dollars, prefer fee_usd: null with confidence: medium over guessing wrong.

**Negative fees / accrual reversals.**

CAFR fee schedules occasionally show negative values representing accrual reversals (a fee recognized in a prior period that was reversed in this period). Notation:
- Parentheses around the figure: "(511)" / "$(90)" -> emit fee_usd as the negative value (after unit conversion)
- Explicit minus sign: "-$2,300" / "-2,300"

Examples:
- "$(511)" under "Dollars in Thousands" -> fee_usd: -511000
- "(90)" under "(in thousands)" -> fee_usd: -90000
- "-$2,300" no unit declaration -> fee_usd: -2300

These are valid data points - emit them with appropriate confidence based on the section heading and firm match. The downstream UI handles negative fees.

**fee_period semantic.**

For each fee_usd you extract, also identify the period basis the disclosure represents. Set fee_period to one of: \`annual\` / \`quarterly\` / \`ytd\` / \`monthly\` / null.

\`annual\` indicators (default for ACFR/CAFR Schedule of Investment Expenses):
- "Schedule of Investment Expenses for the fiscal year ended..."
- "Year ended June 30, 2025" / "Year ended December 31, 2024" / similar fiscal-year context
- "(in thousands)" header without a quarterly qualifier in the surrounding text
- Annual report context, single fiscal-year column

\`quarterly\` indicators (typical of board-meeting packet fee schedules):
- Schedule footer: "Total Quarterly Charges to Funds" / "Total Quarterly Expenses"
- "Q1/Q2/Q3/Q4 [year]" or "First/Second/Third/Fourth Quarter"
- "Three months ended [date]" / "For the quarter ended..."
- "Single-quarter spend" / "during the [quarter] of [year]"
- Source URL or document title references "Board Meeting" + a quarterly cadence

\`ytd\` indicators:
- "Year-to-date" / "YTD"
- "Cumulative through [month] [year]"
- Schedule that progressively updates each quarter (Q3 figure = sum of Q1+Q2+Q3 single-quarter values)

\`monthly\` indicators (rare):
- "For the month of [month] [year]"
- "Monthly retainer"
- Twelve-line schedule with monthly breakouts

When fee_period should be null:
- Source disclosure doesn't explicitly state a period basis
- Multi-line schedule without an unambiguous period header
- You see a fee number but cannot determine what period it represents
- Source is a press release / RFP announcement / IPS partner-page (these confirm relationships, not fee periods)

**Critical rule: NULL is the honest disposition.** Never guess fee_period. If the period isn't explicitly disclosed in source text, leave fee_period as null. A correct null is more valuable than a confident-but-wrong period assignment - the schema gap that motivated this column (Audit 1 P2.7) was caused by the implicit "all fees are annual" assumption misleading users on quarterly disclosures.

Defaults by source type (apply only when the disclosure aligns):
- ACFR/CAFR Schedule of Investment Expenses with a fiscal-year header → \`annual\`
- Board meeting packet fee schedules with the "Total Quarterly Charges to Funds" footer → \`quarterly\`
- Press releases / RFP announcements / IPS partner pages → null (relationship-only sources)
- Investment Policy Statement → null (typically no fee values)

When fee_usd is null (fee not disclosed), also set fee_period to null - period basis is meaningful only when there is a fee value to qualify.

**fee_year semantic.**

fee_year is the calendar year of the fiscal-year-end the fee covers.
- Plan FY July 2024 to June 2025, fee disclosed in FY2025 column -> fee_year=2025
- Plan FY = calendar year 2024 -> fee_year=2024
- Plan FY Oct 2023 to Sep 2024 -> fee_year=2024 (year of FYE)
- Plan FY April 2024 to March 2025, fee disclosed in FY2025 column -> fee_year=2025

When the schedule shows multiple years side-by-side ("FY2024" and "FY2023" columns), emit ONE row per (firm, mandate, fee_year). Multiple rows for the same firm with different fee_years is correct and expected.

When fee_year cannot be determined from immediate context, infer from the document's primary fiscal year-end (provided above). When the document ends June 30 2025 and the fee table has no explicit year column, use fee_year=2025.

**Confidence calibration.**

- high: firm matches a master-list entry by canonical name or alias AND mandate_type is explicit from the section heading. Examples:
  * "Wilshire Advisors, LLC" under "Investment Board Consultant Fees" -> Wilshire matches, mandate=general explicit -> high
  * "Townsend Group" under "Real Estate Consultant Fees" -> Townsend matches, mandate=real_estate explicit -> high
- medium: exactly one of (firm in master list, mandate explicit). Examples:
  * "Cliffwater" under generic "Investment Consultant Fees" -> Cliffwater matches but mandate inferred from default_specialties -> medium
  * "Acme Investment Advisors LLC" under "Real Estate Consultant Fees" -> firm not in master list but mandate=real_estate explicit -> medium
- low: firm extracted from generic "Professional Services" / "Consulting Fees" context where investment-consulting context is uncertain, AND firm is not in master list. Mandate inferred or "other". Examples:
  * "Schedule of Consulting Fees: Some Unknown Firm LLC $50,000" with no further context -> mandate=other, confidence=low
  * "Professional Services: Generic Advisor Inc $25,000" under a non-categorized fee schedule -> mandate=other, confidence=low

If a firm name appears in the EXCLUDE list above, do NOT emit any row regardless of confidence - those are filtered, not low-confidence rows.

**Source excerpt rules.**

source_excerpt should be a verbatim ~200 character window including:
- The section heading (e.g. "Investment Consultant Expenses (Dollars in Thousands)")
- The firm name as it appears
- The fee figure if disclosed

Trim leading/trailing whitespace. Preserve internal punctuation. Min 10 characters, max 500. If a single page contains 8 firms in a tight table, the excerpt for each row can include the section heading once and the specific firm line - they don't need to be radically different.

**Concrete examples.**

POSITIVE example A (CalPERS FY2025 ACFR style):
=== Page 115 ===
Investment Consultant Expenses (Dollars in Thousands)
Wilshire Advisors, LLC                            $1,140
Meketa Investment Group                             $980
Aksia, LLC                                        $2,445
StepStone Group                                   $1,650

-> Emit 4 rows:
  { name_as_written: "Wilshire Advisors, LLC", mandate_type: "general", fee_usd: 1140000, fee_year: 2025, source_page: 115, confidence: "medium", source_excerpt: "Investment Consultant Expenses (Dollars in Thousands) Wilshire Advisors, LLC $1,140" }
  // Wilshire matches master list, but section "Investment Consultant" is generic so mandate is inferred from default_specialties=[general, private_equity] -> general (first by priority). Confidence medium because mandate inferred.
  { name_as_written: "Meketa Investment Group", mandate_type: "general", fee_usd: 980000, fee_year: 2025, source_page: 115, confidence: "medium", ... }
  { name_as_written: "Aksia, LLC", mandate_type: "private_equity", fee_usd: 2445000, fee_year: 2025, source_page: 115, confidence: "medium", ... }
  // Aksia default_specialties=[private_equity, hedge_funds, real_assets] -> private_equity (first by priority).
  { name_as_written: "StepStone Group", mandate_type: "private_equity", fee_usd: 1650000, fee_year: 2025, source_page: 115, confidence: "medium", ... }

POSITIVE example A2 (explicit "Investment Board Consultant" heading - contrast with example A):
=== Page 115 ===
Investment Board Consultant Fees (Dollars in Thousands)
Meketa Investment Group                            $980
Wilshire Advisors, LLC                            $1,140

-> Emit 2 rows:
  { name_as_written: "Meketa Investment Group", mandate_type: "general", fee_usd: 980000, fee_year: 2025, source_page: 115, confidence: "high", source_excerpt: "Investment Board Consultant Fees (Dollars in Thousands) Meketa Investment Group $980" }
  { name_as_written: "Wilshire Advisors, LLC", mandate_type: "general", fee_usd: 1140000, fee_year: 2025, source_page: 115, confidence: "high", source_excerpt: "Investment Board Consultant Fees (Dollars in Thousands) Wilshire Advisors, LLC $1,140" }
  // Both firms in master list AND mandate=general explicit from "Investment Board Consultant" heading (rule 1) -> high confidence. Contrast with example A: same firms under "Investment Consultant Expenses" (no "Board" qualifier) would be medium confidence because mandate is inferred from default_specialties.

POSITIVE example B (CalPERS FY2025 ACFR with explicit mandate sections):
=== Page 116 ===
Real Estate Consultant Fees (Dollars in Thousands)
Townsend Group                                      $850

-> Emit 1 row:
  { name_as_written: "Townsend Group", mandate_type: "real_estate", fee_usd: 850000, fee_year: 2025, source_page: 116, confidence: "high", ... }
  // Townsend in master list AND mandate explicit -> high.

NEGATIVE example A (filter on excluded section):
=== Page 117 ===
Information Technology Consulting
Accenture, LLP                                    $5,200

-> Emit nothing. IT consulting section is excluded.

NEGATIVE example B (filter on excluded firm):
=== Page 151 ===
Investment Consultant Fees
McKinsey & Company                                $1,200

-> Emit nothing. McKinsey is on the firm exclusion list, regardless of the section heading. (McKinsey occasionally provides investment-strategy advisory but their fee here is more often misclassified - we err toward exclusion.)

NEGATIVE example C (operational vendor in catch-all section):
=== Page 115 ===
Investment Consultant Fees (Dollars in Thousands)
Trinity Technology Group, Inc.                    $573

-> Emit nothing. Two reasons: (1) "Trinity Technology Group" is on the specific exclude list as an IT vendor; (2) "Investment Consultant Fees" is a catch-all section heading at CalPERS so non-master-list firms must independently look like investment consultants per the non-master-list filter rules. Trinity's name contains "Technology" which matches the IT vendor pattern.

NEGATIVE example D (individual person in catch-all section):
=== Page 115 ===
Investment Consultant Fees (Dollars in Thousands)
Rosalind Cohen                                    $715

-> Emit nothing. "Rosalind Cohen" has no firm suffix (no LLC, Inc, LP, Group, Partners, Advisors). Individual person names without firm structure are independent contractors, not investment consulting firms. The non-master-list filter excludes them from catch-all sections.

NEGATIVE example E (negative fee accrual reversal - emit it, don't filter):
=== Page 115 ===
Investment Consultant Fees (Dollars in Thousands)
Wilshire Vermont, LLC                            $(511)

-> EMIT this row (note: Wilshire is in master list):
  { name_as_written: "Wilshire Vermont, LLC", mandate_type: "general", fee_usd: -511000, fee_year: 2025, source_page: 115, confidence: "medium", source_excerpt: "Investment Consultant Fees (Dollars in Thousands) Wilshire Vermont, LLC $(511)" }
  // Wilshire matches master list; section is generic so mandate inferred -> general. Parentheses indicate accrual reversal -> fee_usd is negative -511000 after thousands multiplier.

POSITIVE example F (master-list firms in CalPERS-style "Other Investment Expenses" catch-all section):
=== Page 116 ===
Other Investment Expenses (Dollars in Thousands)
Cambridge Associates, LLC                            $22
Hamilton Lane Advisors, LLC                         $499
Stepstone Group, LP                                  $752

-> EMIT 3 rows. All three firms are in the master list, so the non-master-list filter (including the $100K threshold) does NOT apply. Master-list firms always emit when found, regardless of section heading or fee size:
  { name_as_written: "Cambridge Associates, LLC", mandate_type: "private_equity", fee_usd: 22000, fee_year: 2025, source_page: 116, confidence: "medium", source_excerpt: "Other Investment Expenses (Dollars in Thousands) Cambridge Associates, LLC $22" }
  // Cambridge in master list. default_specialties=[private_equity, endowment_consulting]. Section heading is generic so mandate inferred from default_specialties -> private_equity (first in priority order; endowment_consulting is not in mandate_type enum). Confidence medium because mandate inferred. Fee $22K is BELOW the $100K threshold but threshold does NOT apply to master-list firms.
  { name_as_written: "Hamilton Lane Advisors, LLC", mandate_type: "private_equity", fee_usd: 499000, fee_year: 2025, source_page: 116, confidence: "medium", source_excerpt: "Other Investment Expenses (Dollars in Thousands) Hamilton Lane Advisors, LLC $499" }
  // Hamilton Lane in master list. default_specialties=[private_equity, infrastructure]. Generic section heading -> mandate inferred -> private_equity. Confidence medium.
  { name_as_written: "Stepstone Group, LP", mandate_type: "private_equity", fee_usd: 752000, fee_year: 2025, source_page: 116, confidence: "medium", source_excerpt: "Other Investment Expenses (Dollars in Thousands) Stepstone Group, LP $752" }
  // StepStone in master list (alias matches "Stepstone Group, LP"). default_specialties=[private_equity, real_estate, infrastructure]. Generic section heading -> mandate inferred -> private_equity. Confidence medium.

POSITIVE example C (multi-year disclosure):
=== Page 151 ===
Investment Consultant Fees
                                  FY2025      FY2024
Aon                              $1,200      $1,150
Mercer Investment Consulting       $890        $875

-> Emit 4 rows (2 firms x 2 years):
  { name_as_written: "Aon", mandate_type: "general", fee_usd: 1200000, fee_year: 2025, source_page: 151, confidence: "medium", ... }
  { name_as_written: "Aon", mandate_type: "general", fee_usd: 1150000, fee_year: 2024, source_page: 151, confidence: "medium", ... }
  { name_as_written: "Mercer Investment Consulting", mandate_type: "general", fee_usd: 890000, fee_year: 2025, source_page: 151, confidence: "high", ... }
  // Mercer Investment Consulting matches alias of Mercer in master list AND section is investment-consulting (not HR/benefits) AND mandate inference from default_specialties=[general] -> general. The "Investment Consulting" qualifier in the firm name disambiguates from Mercer Health & Benefits.
  { name_as_written: "Mercer Investment Consulting", mandate_type: "general", fee_usd: 875000, fee_year: 2024, source_page: 151, confidence: "high", ... }

**Strict output rules.**

- Call record_consultants exactly once.
- Emit an empty consultants array if the document has only aggregated disclosure without firm names.
- Each row covers one (firm, mandate, fee_year). When the same firm appears in multiple sections (e.g. Aksia listed under both "Investment Consultant" general fees AND "Hedge Fund Consultant"), emit one row per (firm, mandate) pairing.
- name_as_written: verbatim from document, max 200 chars.
- source_excerpt: verbatim, 10-500 chars, includes section heading + firm + fee figure.
- fee_usd: absolute dollars, null when not disclosed.
- fee_year: integer (year of FYE), null when not derivable.
- fee_period: one of 'annual' / 'quarterly' / 'ytd' / 'monthly', or null when period basis is not explicitly disclosed in source text. Default to 'annual' for ACFR Schedule of Investment Expenses with a fiscal-year header. Set null when fee_usd is also null.`;
}
