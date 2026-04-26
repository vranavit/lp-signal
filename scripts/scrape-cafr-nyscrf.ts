/**
 * Ingest the most recent NYSLRS-dedicated ACFR for the New York State Common
 * Retirement Fund.
 *
 * Updated 2026-04-26 (Phase-3 Round 2 of the actuals-gap sprint): switched
 * from the State-government-wide CAFR (osc.ny.gov/files/reports/finance/pdf/
 * annual-comprehensive-financial-report-2025.pdf, 16.0 MB, 310 pp) to the
 * NYSLRS-dedicated ACFR (osc.ny.gov/files/retirement/resources/pdf/
 * annual-comprehensive-financial-report-2025.pdf, 3.05 MB, 222 pp). The
 * State CAFR's allocation table is embedded in an actuarial valuation note
 * as policy-target-only — no per-asset-class actuals. The NYSLRS-dedicated
 * ACFR has explicit "the [class] target allocation was X% while the actual
 * allocation was Y%" prose for each asset class on pp.94-99. See
 * docs/audits/actuals-gap-phase1-2026-04-26.md (Phase 1 diagnosis).
 *
 * Run scripts/replace-allocation-source.ts --plan-key=nyscrf first to drop
 * the prior State-CAFR document + its 9 allocation rows.
 *
 * URL pattern: osc.ny.gov/files/retirement/resources/pdf/annual-comprehensive-financial-report-{YYYY}.pdf
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ingestCafr } from "@/lib/scrapers/cafr";

const CAFR_URL =
  "https://www.osc.ny.gov/files/retirement/resources/pdf/annual-comprehensive-financial-report-2025.pdf";
const FISCAL_YEAR_END = "2025-03-31"; // NYSLRS FY ends March 31.

async function main() {
  const supabase = createSupabaseAdminClient();
  const { data: plan, error } = await supabase
    .from("plans")
    .select("id, name")
    .eq("name", "New York State Common Retirement Fund")
    .single();
  if (error || !plan) throw new Error(`NYSCRF not found: ${error?.message}`);

  console.log(`Plan: ${plan.name} (${plan.id})`);
  const r = await ingestCafr(supabase, {
    planId: plan.id,
    planKey: "nyscrf",
    url: CAFR_URL,
    fiscalYearEnd: FISCAL_YEAR_END,
  });
  console.log(`URL:       ${r.url}`);
  console.log(`Fetched:   ${r.fetched}`);
  console.log(`Inserted:  ${r.inserted}`);
  console.log(`Skipped:   ${r.skipped}`);
  console.log(`Bytes:     ${(r.bytes / 1024 / 1024).toFixed(1)} MB`);
  if (r.error) console.log(`Error:     ${r.error}`);
  if (r.documentId) console.log(`DocumentId:${r.documentId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
