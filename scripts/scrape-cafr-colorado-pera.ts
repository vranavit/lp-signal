/**
 * Day 10 Task C+ Component 2: Colorado PERA allocation-report ingestion.
 *
 * Colorado PERA does not publish board-meeting minutes, so it is a
 * CAFR-only plan. This is a one-off runner (no cron — annual reports
 * publish yearly; re-ingesting each year is a scheduled task for future
 * sessions or for the /api/cron/scrape-cafr weekly heartbeat when per-
 * plan URL discovery is wired).
 *
 * Source: https://content.copera.org/wp-content/uploads/YYYY/MM/*.pdf
 *
 * PDF-compatibility blocker. The PERA full ACFRs (FY2022–FY2024) and
 * the FY2024 PAFR/PERAPlus reports all fail pdf-lib's
 * PDFDocument.load() with `Expected instance of PDFDict, but got
 * instance of undefined` even with `throwOnInvalidObject: false` — the
 * library rejects the pdf cross-reference structure before the
 * classifier can send the file to Anthropic. A live probe over nine
 * candidate PDFs (see `probe-pera.ts` in git history) found one that
 * parses cleanly: the FY2023 Popular Annual Financial Report (4.0 MB,
 * 16 pages). It covers the fiscal year ended 2023-12-31 and includes
 * a summary asset-allocation breakdown.
 *
 * Why not the larger ACFR? FY2024 ACFR is 84 MB (exceeds Anthropic's
 * 32 MB base64 ceiling); FY2023 ACFR is 60 MB (same); FY2022 ACFR is
 * 7.1 MB but pdf-lib can't parse it. The FY2023 PAFR is the
 * recent-and-parseable intersection.
 *
 * Once the classifier migrates to the Anthropic Files API (which
 * bypasses pdf-lib validation and the 32 MB ceiling), swap DEFAULT_URL
 * to the FY2024 full ACFR for full target + actual coverage.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/scrape-cafr-colorado-pera.ts
 *   pnpm tsx --env-file=.env.local scripts/scrape-cafr-colorado-pera.ts --url=<alternate URL> --fiscal-year-end=YYYY-MM-DD
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ingestCafr } from "@/lib/scrapers/cafr";

const DEFAULT_URL =
  "https://content.copera.org/wp-content/uploads/2024/07/popular-annual-financial-report-2023.pdf";
const DEFAULT_FISCAL_YEAR_END = "2023-12-31";

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
    .eq("scrape_config->>key", "colorado_pera")
    .single();
  if (error || !plan) {
    throw new Error(
      `Colorado PERA plan not seeded (apply 20260501000010_seed_colorado_pera.sql first): ${error?.message ?? "not found"}`,
    );
  }

  console.log(`Plan: ${plan.name} (${plan.id})`);
  console.log(`URL:  ${url}`);
  console.log(`FYE:  ${fiscalYearEnd}`);

  const r = await ingestCafr(supabase, {
    planId: plan.id,
    planKey: "colorado-pera",
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
