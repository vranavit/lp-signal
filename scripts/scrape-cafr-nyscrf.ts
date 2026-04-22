/**
 * Ingest the most recent NYSCRF ACFR.
 * URL pattern: https://www.osc.ny.gov/files/reports/finance/pdf/annual-comprehensive-financial-report-{YYYY}.pdf
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ingestCafr } from "@/lib/scrapers/cafr";

const CAFR_URL =
  "https://www.osc.ny.gov/files/reports/finance/pdf/annual-comprehensive-financial-report-2025.pdf";
const FISCAL_YEAR_END = "2025-03-31"; // NY state FY ends March 31.

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
