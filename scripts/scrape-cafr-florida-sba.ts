/**
 * Unblock Florida SBA CAFR ingestion.
 *
 * Florida SBA has been flagged "Akamai edge block" in
 * docs/scraper-inventory.md since Day 9.3 — plain curl hits 403 on
 * both the listing page and media URLs. The existing
 * `lib/scrapers/http.ts::fetchWithDefaults` ships realistic Chrome
 * headers (UA + Accept + Sec-Fetch-* + keep-alive) which is enough
 * to get past Akamai for the direct media path; probed via the helper
 * returns 200 + 2.1 MB for the FY2023-24 AIR.
 *
 * Source: https://www.sbafla.com/reporting/annual-investment-reports/
 *
 * FY2023-24 Annual Investment Report (AIR), 2.1 MB. Florida SBA's
 * fiscal year ends June 30, so "2023-24 AIR" covers FY ended
 * 2024-06-30. This is the latest AIR available on the site (FY2024-25
 * expected to land ~Dec 2025 if the publishing cadence holds).
 *
 * Note on document_type: ingestCafr writes document_type='cafr' so the
 * classifier routes through extractAllocationsFromCafrPdf (produces
 * pension_allocations rows). Using 'annual_report' would route through
 * the pension-signals path which would yield zero signals on a
 * year-end report.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/scrape-cafr-florida-sba.ts
 *   pnpm tsx --env-file=.env.local scripts/scrape-cafr-florida-sba.ts --url=<alternate URL> --fiscal-year-end=YYYY-MM-DD
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ingestCafr } from "@/lib/scrapers/cafr";

const DEFAULT_URL =
  "https://www.sbafla.com/media/zxxprkng/2023-2024-air-draft3625-final-updated.pdf";
const DEFAULT_FISCAL_YEAR_END = "2024-06-30";

function parseArgs() {
  let url = DEFAULT_URL;
  let fiscalYearEnd = DEFAULT_FISCAL_YEAR_END;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--url=")) url = a.slice("--url=".length);
    else if (a.startsWith("--fiscal-year-end="))
      fiscalYearEnd = a.slice("--fiscal-year-end=".length);
  }
  return { url, fiscalYearEnd };
}

async function main() {
  const { url, fiscalYearEnd } = parseArgs();
  const supabase = createSupabaseAdminClient();

  const { data: plan, error } = await supabase
    .from("plans")
    .select("id, name")
    .eq("scrape_config->>key", "fsba")
    .single();
  if (error || !plan) {
    throw new Error(`Florida SBA plan not found: ${error?.message ?? "not found"}`);
  }

  console.log(`[Florida SBA] Plan: ${plan.name} (${plan.id})`);
  console.log(`[Florida SBA] URL:  ${url}`);
  console.log(`[Florida SBA] FYE:  ${fiscalYearEnd}`);

  const r = await ingestCafr(supabase, {
    planId: plan.id,
    planKey: "florida-sba",
    url,
    fiscalYearEnd,
  });

  console.log(
    `[Florida SBA] fetched=${r.fetched} inserted=${r.inserted} skipped=${r.skipped} bytes=${(r.bytes / 1024 / 1024).toFixed(2)}MB${r.error ? " error=" + r.error : ""}`,
  );
  if (r.documentId) console.log(`[Florida SBA] documentId=${r.documentId}`);
  if (r.error) process.exit(1);
}

main().catch((e) => {
  console.error(`[Florida SBA] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
