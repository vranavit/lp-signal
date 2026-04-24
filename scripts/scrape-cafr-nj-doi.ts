/**
 * Day 10 signal-only→thorough batch: NJ Division of Investment Annual Report ingestion.
 *
 * NJ Pension Fund fiscal year ends June 30. The Annual Report (which
 * the Division publishes in lieu of a GFOA-style ACFR) lives at
 * /treasury/doinvest/pdf/AnnualReport/AnnualReportforFiscalYearYYYY.pdf
 * and includes target + actual asset allocation for the State
 * Investment Council-managed pool.
 *
 * Source:
 *   https://www.nj.gov/treasury/doinvest/pdf/AnnualReport/AnnualReportforFiscalYear2024.pdf
 *
 * FY2024 (ended 2024-06-30). 0.8 MB — the smallest of this batch.
 * Board-minutes scraper (lib/scrapers/nj-doi.ts) already runs daily
 * for commitment signals; this runner is the annual allocation pass.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/scrape-cafr-nj-doi.ts
 *   pnpm tsx --env-file=.env.local scripts/scrape-cafr-nj-doi.ts --url=<alternate URL> --fiscal-year-end=YYYY-MM-DD
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ingestCafr } from "@/lib/scrapers/cafr";

const DEFAULT_URL =
  "https://www.nj.gov/treasury/doinvest/pdf/AnnualReport/AnnualReportforFiscalYear2024.pdf";
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
    .eq("scrape_config->>key", "nj_doi")
    .single();
  if (error || !plan) {
    throw new Error(`NJ DOI plan not found: ${error?.message ?? "not found"}`);
  }

  console.log(`Plan: ${plan.name} (${plan.id})`);
  console.log(`URL:  ${url}`);
  console.log(`FYE:  ${fiscalYearEnd}`);

  const r = await ingestCafr(supabase, {
    planId: plan.id,
    planKey: "nj-doi",
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
