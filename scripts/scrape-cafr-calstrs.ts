/**
 * Ingest the most recent CalSTRS ACFR.
 * Latest filename (FY 2024-25): /files/66e3865e9/ACFR2024-25.pdf on calstrs.com.
 * The random hash in the path means next year's URL will differ — update here.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ingestCafr } from "@/lib/scrapers/cafr";

const CAFR_URL = "https://www.calstrs.com/files/66e3865e9/ACFR2024-25.pdf";
const FISCAL_YEAR_END = "2025-06-30"; // CalSTRS FY ends June 30.

async function main() {
  const supabase = createSupabaseAdminClient();
  const { data: plan, error } = await supabase
    .from("plans")
    .select("id, name")
    .eq("name", "CalSTRS")
    .single();
  if (error || !plan) throw new Error(`CalSTRS not found: ${error?.message}`);

  console.log(`Plan: ${plan.name} (${plan.id})`);
  const r = await ingestCafr(supabase, {
    planId: plan.id,
    planKey: "calstrs",
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
