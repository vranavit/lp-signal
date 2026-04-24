/**
 * Day 10 Task C+ Component 2: Colorado PERA CAFR ingestion.
 *
 * Colorado PERA does not publish board-meeting minutes, so it is a
 * CAFR-only plan. This is a one-off runner (no cron — CAFRs publish
 * annually and re-ingesting each year is a scheduled task for future
 * sessions or for the /api/cron/scrape-cafr weekly heartbeat when per-
 * plan URL discovery is wired).
 *
 * Source: https://content.copera.org/wp-content/uploads/YYYY/MM/*.pdf
 *
 * Size blocker note. PERA's FY2024 ACFR (published 2025-06) is 84 MB,
 * which exceeds Anthropic's 32 MB base64 request ceiling. The FY2023
 * ACFR is 60 MB — also too large. The FY2022 ACFR is 7.1 MB and is the
 * largest that fits the current ingestion path, so we default to it.
 * Once the classifier migrates to the Anthropic Files API, swap
 * DEFAULT_URL to the FY2024 link and update FISCAL_YEAR_END.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/scrape-cafr-colorado-pera.ts
 *   pnpm tsx --env-file=.env.local scripts/scrape-cafr-colorado-pera.ts --url=<alternate URL> --fiscal-year-end=YYYY-MM-DD
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ingestCafr } from "@/lib/scrapers/cafr";

const DEFAULT_URL =
  "https://content.copera.org/wp-content/uploads/2024/07/pera-annual-comprehensive-financial-report-2022.pdf";
const DEFAULT_FISCAL_YEAR_END = "2022-12-31";

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
