/**
 * Day 6 Florida SBA fallback: Wisconsin SWIB 2024 Annual Report.
 *
 * Florida SBA sits behind Akamai bot-wall (403 on all media URLs even with
 * browser-like headers). Day 6 rule authorizes swapping in a fallback
 * pension — SWIB was already seeded in plans but had no allocation data.
 * 2024 SWIB Annual Report is 1.2 MB, well within all limits.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ingestCafr } from "@/lib/scrapers/cafr";

const CAFR_URL =
  "https://www.swib.state.wi.us/wp-content/uploads/2026/03/2024-SWIB-Annual-Report.pdf";
const FISCAL_YEAR_END = "2024-12-31"; // SWIB reports on calendar year.

async function main() {
  const supabase = createSupabaseAdminClient();
  const { data: plan, error } = await supabase
    .from("plans")
    .select("id, name")
    .eq("name", "Wisconsin SWIB")
    .single();
  if (error || !plan) throw new Error(`Wisconsin SWIB not found: ${error?.message}`);
  console.log(`Plan: ${plan.name} (${plan.id})`);
  const r = await ingestCafr(supabase, {
    planId: plan.id,
    planKey: "wisconsin-swib",
    url: CAFR_URL,
    fiscalYearEnd: FISCAL_YEAR_END,
  });
  console.log(
    `URL: ${r.url}\nfetched=${r.fetched} inserted=${r.inserted} skipped=${r.skipped} bytes=${(r.bytes / 1024 / 1024).toFixed(1)}MB${r.error ? " error=" + r.error : ""}`,
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
