/**
 * Ingest the most recent Illinois TRS ACFR.
 * Latest: ACFR-FY25-web_0.pdf (~5 MB, FY ending June 30 2025).
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ingestCafr } from "@/lib/scrapers/cafr";

const CAFR_URL =
  "https://www.trsil.org/sites/default/files/documents/ACFR-FY25-web_0.pdf";
const FISCAL_YEAR_END = "2025-06-30";

async function main() {
  const supabase = createSupabaseAdminClient();
  const { data: plan, error } = await supabase
    .from("plans")
    .select("id, name")
    .eq("name", "TRS Illinois")
    .single();
  if (error || !plan) throw new Error(`TRS Illinois not found: ${error?.message}`);
  console.log(`Plan: ${plan.name} (${plan.id})`);
  const r = await ingestCafr(supabase, {
    planId: plan.id,
    planKey: "trs-illinois",
    url: CAFR_URL,
    fiscalYearEnd: FISCAL_YEAR_END,
  });
  console.log(
    `URL: ${r.url}\nfetched=${r.fetched} inserted=${r.inserted} skipped=${r.skipped} bytes=${(r.bytes / 1024 / 1024).toFixed(1)}MB${r.error ? " error=" + r.error : ""}`,
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
