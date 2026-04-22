/**
 * Ingest the most recent WSIB annual report.
 * URL pattern: https://www.sib.wa.gov/docs/reports/annual/ar{YY}.pdf
 * Latest:      ar25.pdf (10.5 MB, FY ending June 30 2025).
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ingestCafr } from "@/lib/scrapers/cafr";

const CAFR_URL = "https://www.sib.wa.gov/docs/reports/annual/ar25.pdf";
const FISCAL_YEAR_END = "2025-06-30"; // Washington state FY ends June 30.

async function main() {
  const supabase = createSupabaseAdminClient();
  const { data: plan, error } = await supabase
    .from("plans")
    .select("id, name")
    .eq("name", "Washington State Investment Board")
    .single();
  if (error || !plan) throw new Error(`WSIB not found: ${error?.message}`);
  console.log(`Plan: ${plan.name} (${plan.id})`);

  const r = await ingestCafr(supabase, {
    planId: plan.id,
    planKey: "wsib",
    url: CAFR_URL,
    fiscalYearEnd: FISCAL_YEAR_END,
  });
  console.log(
    `URL: ${r.url}\nfetched=${r.fetched} inserted=${r.inserted} skipped=${r.skipped} bytes=${(r.bytes / 1024 / 1024).toFixed(1)}MB${r.error ? " error=" + r.error : ""}`,
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
