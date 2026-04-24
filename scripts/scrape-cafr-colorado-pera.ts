/**
 * Day 10 Task C+ Component 2: Colorado PERA allocation-report ingestion.
 *
 * Colorado PERA does not publish board-meeting minutes, so it is a
 * CAFR-only plan. One-off runner — annual reports publish yearly.
 *
 * Source: https://content.copera.org/wp-content/uploads/YYYY/MM/*.pdf
 *
 * Default now points at the FY2024 full ACFR (84 MB). The classifier's
 * Files-API fallback (lib/classifier/files-api.ts) uploads the PDF to
 * Anthropic's file store and classifies via file_id instead of inlining
 * base64 — bypassing the 32 MB inline request ceiling entirely. pdf-lib
 * still rejects the PERA ACFR's cross-reference structure, but we don't
 * need pdf-lib on the Files-API path because Anthropic parses the PDF
 * server-side with its own parser.
 *
 * Prior default was the FY2023 PAFR (4.0 MB, 16 pages) — chosen when
 * pdf-lib + base64 was the only path and every full PERA ACFR blew up.
 * Keep the PAFR URL handy as an emergency override (see --url flag) in
 * case the Files-API path has an outage.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/scrape-cafr-colorado-pera.ts
 *   pnpm tsx --env-file=.env.local scripts/scrape-cafr-colorado-pera.ts --url=<alternate URL> --fiscal-year-end=YYYY-MM-DD
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  ingestCafr,
  downloadPdfBytes,
  insertOversizedCafrRow,
  SUPABASE_STORAGE_CAP_BYTES,
} from "@/lib/scrapers/cafr";
import { classifyCafrFromBytes } from "@/lib/classifier";

const DEFAULT_URL =
  "https://content.copera.org/wp-content/uploads/2025/06/Annual-Comprehensive-Financial-Report.pdf";
const DEFAULT_FISCAL_YEAR_END = "2024-12-31";

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
    .select("id, name, tier")
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

  // PERA FY2024 ACFR is 84 MB — exceeds the 50 MB Supabase storage
  // project cap on this project. Probe size first and choose between
  // the standard ingestCafr path (≤50 MB) and the oversized-bypass path
  // (download → insert doc row with null storage_path → classify
  // inline via Files API). This keeps the regular runner behavior for
  // smaller URL overrides (FY2023 PAFR, etc.).
  const probe = await downloadPdfBytes(url);
  console.log(
    `downloaded ${(probe.bytes.length / 1024 / 1024).toFixed(2)}MB (hash=${probe.hash.slice(0, 12)})`,
  );

  if (probe.bytes.length <= SUPABASE_STORAGE_CAP_BYTES) {
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
    return;
  }

  console.log(
    `\nPDF exceeds Supabase storage cap (${(SUPABASE_STORAGE_CAP_BYTES / 1024 / 1024).toFixed(0)}MB) — using oversized bypass (Files API inline).`,
  );
  const { documentId, alreadyExisted } = await insertOversizedCafrRow(supabase, {
    planId: plan.id,
    url,
    fiscalYearEnd,
    hash: probe.hash,
  });
  console.log(
    `documentId=${documentId}${alreadyExisted ? " (already existed — reclassifying)" : " (new row)"}`,
  );
  // Make sure the row is pending so classifyCafrFromBytes will process it.
  await supabase
    .from("documents")
    .update({ processing_status: "processing", error_message: null, processed_at: null })
    .eq("id", documentId);

  const outcome = await classifyCafrFromBytes(
    supabase,
    {
      id: documentId,
      plan_id: plan.id,
      storage_path: null,
      meeting_date: fiscalYearEnd,
      source_url: url,
    },
    { id: plan.id, name: plan.name, tier: plan.tier },
    probe.bytes,
  );
  console.log(`\nclassify outcome: ${JSON.stringify(outcome, null, 2)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
