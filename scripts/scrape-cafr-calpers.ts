/**
 * Ingest the most recent CalPERS investment-focused annual report.
 * The full ACFR (acfr-2025) is 30.4 MB — past Anthropic's 32 MB per-request
 * limit once base64 encoding inflates the payload. The Annual Investment
 * Report is CalPERS' purpose-built, investment-only companion: same asset
 * allocation tables, no actuarial/legal bloat, ~5–8 MB.
 *
 * URL pattern:  https://www.calpers.ca.gov/documents/annual-investment-report-fy-{YYYY}/download?inline
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ingestCafr } from "@/lib/scrapers/cafr";

const CAFR_URL =
  "https://www.calpers.ca.gov/documents/annual-investment-report-fy-2025/download?inline";
const FISCAL_YEAR_END = "2025-06-30"; // CalPERS FY ends June 30.

async function main() {
  const supabase = createSupabaseAdminClient();
  const { data: plan, error } = await supabase
    .from("plans")
    .select("id, name")
    .eq("name", "CalPERS")
    .single();
  if (error || !plan) throw new Error(`CalPERS not found: ${error?.message}`);

  console.log(`Plan: ${plan.name} (${plan.id})`);
  const r = await ingestCafr(supabase, {
    planId: plan.id,
    planKey: "calpers",
    url: CAFR_URL,
    fiscalYearEnd: FISCAL_YEAR_END,
  });
  print(r);
}

function print(r: ReturnType<typeof ingestCafr> extends Promise<infer T> ? T : never) {
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
