/**
 * Day 5 Task 4 pivot: ingest CalSTRS' two prior fiscal year ACFRs to give
 * the policy-change detector something to compare against the FY24-25 data
 * already ingested on Day 4. The ACFR landing page exposes three years
 * directly:
 *
 *   ACFR2024-25.pdf   (already ingested as 2025-06-30)
 *   ACFR2023-24.pdf   (this run, 2024-06-30)
 *   ACFR2022-23.pdf   (this run, 2023-06-30)
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ingestCafr } from "@/lib/scrapers/cafr";

const SOURCES = [
  {
    url: "https://www.calstrs.com/files/d83bd9800/ACFR2023-24.pdf",
    fiscalYearEnd: "2024-06-30",
    label: "CalSTRS 2023-24 ACFR",
  },
  {
    url: "https://www.calstrs.com/files/c92dd4f59/ACFR2022-23.pdf",
    fiscalYearEnd: "2023-06-30",
    label: "CalSTRS 2022-23 ACFR",
  },
];

async function main() {
  const supabase = createSupabaseAdminClient();
  const { data: plan, error } = await supabase
    .from("plans")
    .select("id, name")
    .eq("name", "CalSTRS")
    .single();
  if (error || !plan) throw new Error(`CalSTRS not found: ${error?.message}`);
  console.log(`Plan: ${plan.name} (${plan.id})`);

  for (const s of SOURCES) {
    const r = await ingestCafr(supabase, {
      planId: plan.id,
      planKey: "calstrs",
      url: s.url,
      fiscalYearEnd: s.fiscalYearEnd,
    });
    console.log(
      `\n${s.label}\n  fetched=${r.fetched} inserted=${r.inserted} skipped=${r.skipped} bytes=${(r.bytes / 1024 / 1024).toFixed(1)}MB${r.error ? " error=" + r.error : ""}`,
    );
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
