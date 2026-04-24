/**
 * Day 10 signal-only→thorough batch: NYSTRS PAFR ingestion.
 *
 * NYSTRS (New York State Teachers' Retirement System) fiscal year ends
 * June 30. The full ACFR is published at nystrs.org/getmedia/<uuid>/.
 *
 * Default URL targets the Popular Annual Financial Report (PAFR), NOT
 * the full ACFR, because the FY2025 ACFR is 47.8 MB and the FY2024
 * ACFR is 27.4 MB (base64-expanded to ~36.5 MB, over the Anthropic
 * 32 MB inline request ceiling). The PAFR at 4.3 MB summarises both
 * FY2024 and FY2025 and contains the same target / actual allocation
 * breakdown the CAFR classifier extracts.
 *
 * Source:
 *   https://www.nystrs.org/getmedia/7c065b22-f861-4931-b633-6c1fe65fffc6/PAFR.pdf
 *
 * Once the classifier migrates to the Anthropic Files API (which
 * bypasses the inline base64 ceiling), swap DEFAULT_URL to the full
 * FY2025 ACFR:
 *   https://www.nystrs.org/getmedia/aa31d8ed-8708-4985-be81-8e124f48dad2/2025-ACFR.pdf
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/scrape-cafr-nystrs.ts
 *   pnpm tsx --env-file=.env.local scripts/scrape-cafr-nystrs.ts --url=<alternate URL> --fiscal-year-end=YYYY-MM-DD
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ingestCafr } from "@/lib/scrapers/cafr";

const DEFAULT_URL =
  "https://www.nystrs.org/getmedia/7c065b22-f861-4931-b633-6c1fe65fffc6/PAFR.pdf";
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
