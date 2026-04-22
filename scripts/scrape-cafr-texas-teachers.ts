/**
 * Ingest the most recent TRS Texas allocation/financial source.
 *
 * The full 2023 ACFR (7.7 MB, most recent directly-linkable full ACFR) is
 * the primary source. Secondary: Fund Insights (~100 KB, FY25 summary).
 * Both are worth ingesting — the ACFR anchors policy + actuals while Fund
 * Insights gives a fresher snapshot.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ingestCafr } from "@/lib/scrapers/cafr";

const SOURCES = [
  {
    url: "https://www.trs.texas.gov/sites/default/files/migrated/2023%20ACFR%20Final%2011-20-2023.pdf",
    fiscalYearEnd: "2023-08-31",
    label: "TRS Texas 2023 ACFR",
  },
  {
    url: "https://www.trs.texas.gov/files/documents/fund-insights.pdf",
    fiscalYearEnd: "2025-08-31",
    label: "TRS Texas Fund Insights FY25",
  },
];

async function main() {
  const supabase = createSupabaseAdminClient();
  const { data: plan, error } = await supabase
    .from("plans")
    .select("id, name")
    .eq("name", "Teacher Retirement System of Texas")
    .single();
  if (error || !plan) throw new Error(`TRS Texas not found: ${error?.message}`);
  console.log(`Plan: ${plan.name} (${plan.id})`);

  for (const s of SOURCES) {
    const r = await ingestCafr(supabase, {
      planId: plan.id,
      planKey: "trs-texas",
      url: s.url,
      fiscalYearEnd: s.fiscalYearEnd,
    });
    console.log(
      `\n${s.label}\n  fetched=${r.fetched} inserted=${r.inserted} skipped=${r.skipped} bytes=${(r.bytes / 1024 / 1024).toFixed(1)}MB${r.error ? " error=" + r.error : ""}`,
    );
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
