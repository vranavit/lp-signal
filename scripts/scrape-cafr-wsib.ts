/**
 * Ingest the most recent WSIB quarterly investment report.
 *
 * Updated 2026-04-26 (Phase-3 Round 2 of the actuals-gap sprint): switched
 * from the WSIB Annual Report (ar25.pdf, 10.0 MB, 234 pp) to the Q2 2025
 * Quarterly Investment Report (qr063025.pdf, 0.84 MB, 25 pp). The Annual
 * Report carries only target narrative; the quarterly report's p.4 has a
 * clean CTF table with Market Value $ + Actual % + Range for all 7 asset
 * classes. See docs/audits/actuals-gap-phase1-2026-04-26.md.
 *
 * The classifier handles quarterly reports the same as annual ACFRs — same
 * target+actual table structure, just a quarter-end as-of date instead of
 * fiscal-year-end. The "fiscalYearEnd" arg name is retained but interpreted
 * as the snapshot date.
 *
 * Run scripts/replace-allocation-source.ts --plan-name="Washington State
 * Investment Board" first to drop the prior Annual-Report document + its 7
 * target-only allocation rows.
 *
 * URL pattern: sib.wa.gov/docs/reports/quarterly/qrMMDDYY.pdf
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ingestCafr } from "@/lib/scrapers/cafr";

const CAFR_URL = "https://www.sib.wa.gov/docs/reports/quarterly/qr063025.pdf";
const FISCAL_YEAR_END = "2025-06-30"; // Q2 2025 quarter end.

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
