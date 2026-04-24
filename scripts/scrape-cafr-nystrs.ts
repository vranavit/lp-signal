/**
 * Day 10 signal-only→thorough batch: NYSTRS full ACFR ingestion.
 *
 * NYSTRS (New York State Teachers' Retirement System) fiscal year ends
 * June 30. Default now targets the FY2025 full ACFR (47.8 MB), which
 * routes automatically through the Files-API fallback (lib/classifier/
 * files-api.ts) because it exceeds the 24 MB inline-base64 threshold.
 *
 * Full ACFR vs PAFR: both report 11 asset-class rows but the ACFR
 * provides sub-class granularity (Domestic / International / Global
 * Equity, Domestic FI / High-Yield Bonds / Global Bonds, Real Estate
 * Debt vs Private Debt under Credit) that the PAFR summary aggregates.
 *
 * Source:
 *   https://www.nystrs.org/getmedia/aa31d8ed-8708-4985-be81-8e124f48dad2/2025-ACFR.pdf
 *
 * Prior default (keep for rollback) — FY2024/FY2025 PAFR (4.3 MB):
 *   https://www.nystrs.org/getmedia/7c065b22-f861-4931-b633-6c1fe65fffc6/PAFR.pdf
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/scrape-cafr-nystrs.ts
 *   pnpm tsx --env-file=.env.local scripts/scrape-cafr-nystrs.ts --url=<alternate URL> --fiscal-year-end=YYYY-MM-DD
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ingestCafr } from "@/lib/scrapers/cafr";

const DEFAULT_URL =
  "https://www.nystrs.org/getmedia/aa31d8ed-8708-4985-be81-8e124f48dad2/2025-ACFR.pdf";
const DEFAULT_FISCAL_YEAR_END = "2025-06-30";

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
    .eq("scrape_config->>key", "nystrs")
    .single();
  if (error || !plan) {
    throw new Error(`NYSTRS plan not found: ${error?.message ?? "not found"}`);
  }

  console.log(`Plan: ${plan.name} (${plan.id})`);
  console.log(`URL:  ${url}`);
  console.log(`FYE:  ${fiscalYearEnd}`);

  const r = await ingestCafr(supabase, {
    planId: plan.id,
    planKey: "nystrs",
    url,
    fiscalYearEnd,
  });

  console.log(
    `\nfetched=${r.fetched} inserted=${r.inserted} skipped=${r.skipped} bytes=${(r.bytes / 1024 / 1024).toFixed(2)}MB${r.error ? " error=" + r.error : ""}`,
  );
  if (r.documentId) console.log(`documentId=${r.documentId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
