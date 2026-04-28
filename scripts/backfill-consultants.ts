/**
 * Workstream 2 Phase A Block 3: production extraction across 11 Category A plans.
 *
 * For each of the 11 plans whose CAFRs reliably itemize investment consultants
 * (per Phase A1 validation), runs the v1.5-consultants pipeline end-to-end and
 * inserts the resulting (firm, mandate, fee_year) rows into plan_consultants.
 *
 * Idempotency: ON CONFLICT (plan_id, consultant_id, mandate_type, fee_year) DO
 * UPDATE SET fee_usd, source_excerpt, source_document_id, updated_at. Re-runs
 * keep existing rows but refresh the fee + source if they changed.
 *
 * Resilience: per-plan errors are logged and DO NOT halt the run. One bad
 * plan doesn't poison the other 10.
 *
 * Cost estimate: 11 plans x ~20K tokens x Sonnet 4.6 ($3 input / $15 output) =
 * ~$0.50-$3.00 across the run depending on input/output mix. Runtime ~15-25
 * minutes (download + extract + classifier per plan).
 *
 * Non-master-list extractions are SKIPPED for now (logged to stdout for
 * follow-up review). Adding them to the master list is a separate manual
 * decision per firm.
 *
 * Usage:
 *   set -a && source .env.local && set +a
 *   pnpm tsx scripts/backfill-consultants.ts
 *
 * Read-only diagnostic mode (no inserts; just shows what WOULD be written):
 *   pnpm tsx scripts/backfill-consultants.ts --dry-run
 */

import { Client } from "pg";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { extractConsultantPages } from "@/lib/classifier/extract-consultant-pages";
import { extractConsultantsFromText } from "@/lib/classifier/extract-consultants";
import { resolveCanonicalEntry } from "@/lib/classifier/match-consultant";
import type { MasterListEntry } from "@/lib/classifier/prompts/consultants";

// 11 Category A plans, one canonical CAFR doc per plan.
// Order matches the master coverage list; doc_ids verified via Phase A1 triage.
const DOCS: Array<{ docId: string; planName: string }> = [
  { docId: "aff53f2a-a761-475b-9929-5014a99592cc", planName: "CalPERS" },
  { docId: "3159c77f-4097-47c2-b5b9-150ed80e9907", planName: "CalSTRS" },
  { docId: "ed6a4589-054d-462f-8d5f-42ca7feb898d", planName: "LACERA" },
  { docId: "3f5ba09d-a570-4e68-a7d7-198de19ef90f", planName: "Massachusetts PRIM" },
  { docId: "48e41025-0de2-424c-ab20-3c3c6c0d28a1", planName: "Minnesota State Board of Investment" },
  { docId: "c77ecedc-2d2f-4a5f-8203-e06342cfbce1", planName: "New York State Common Retirement Fund" },
  { docId: "164baaca-1153-41f2-af78-a179e9ace942", planName: "NYSTRS" },
  { docId: "0b4eca08-cf34-4c99-aa82-6cba6b71eda6", planName: "PA PSERS" },
  { docId: "82c852ea-5db8-4dc1-992e-841d0f9959ed", planName: "Teacher Retirement System of Texas" },
  { docId: "7c287af1-b96d-4d8a-9b1a-63f39acda33a", planName: "TRS Illinois" },
  { docId: "af0db335-3358-4d2c-8574-fd767991ac9e", planName: "Virginia Retirement System" },
];

type MasterListEntryWithId = MasterListEntry & { id: string };

type PerPlanResult = {
  planName: string;
  docId: string;
  status: "complete" | "no_pages" | "error";
  errorMessage: string | null;
  totalPages: number;
  filteredPages: number;
  consultantsExtracted: number;
  consultantsInsertedOrUpdated: number;
  inserted: number;
  updated: number;
  nonMasterListSkipped: Array<{ name: string; mandate: string; fee_usd: number | null }>;
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
};

async function loadMasterListWithIds(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
): Promise<MasterListEntryWithId[]> {
  const { data, error } = await supabase
    .from("consultants")
    .select("id, canonical_name, name_aliases, default_specialties");
  if (error) throw new Error(`master list query failed: ${error.message}`);
  return (data ?? []) as MasterListEntryWithId[];
}

async function processOnePlan(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  pgClient: Client,
  docId: string,
  planName: string,
  masterList: MasterListEntryWithId[],
  dryRun: boolean,
): Promise<PerPlanResult> {
  const blank: PerPlanResult = {
    planName,
    docId,
    status: "complete",
    errorMessage: null,
    totalPages: 0,
    filteredPages: 0,
    consultantsExtracted: 0,
    consultantsInsertedOrUpdated: 0,
    inserted: 0,
    updated: 0,
    nonMasterListSkipped: [],
    tokensUsed: 0,
    inputTokens: 0,
    outputTokens: 0,
  };

  const { data: doc, error: docErr } = await supabase
    .from("documents")
    .select("id, plan_id, storage_path, source_url, meeting_date")
    .eq("id", docId)
    .single();
  if (docErr || !doc) {
    return { ...blank, status: "error", errorMessage: `document not found: ${docErr?.message ?? "no row"}` };
  }
  if (!doc.plan_id) {
    return { ...blank, status: "error", errorMessage: "document has no plan_id" };
  }
  if (!doc.storage_path) {
    return { ...blank, status: "error", errorMessage: "document has null storage_path (oversized via Files API)" };
  }

  const { data: blob, error: dlErr } = await supabase.storage
    .from("documents")
    .download(doc.storage_path);
  if (dlErr || !blob) {
    return { ...blank, status: "error", errorMessage: `storage download failed: ${dlErr?.message ?? "no blob"}` };
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());

  let pageResult: Awaited<ReturnType<typeof extractConsultantPages>>;
  try {
    pageResult = await extractConsultantPages(bytes);
  } catch (e) {
    return { ...blank, status: "error", errorMessage: `unpdf parse failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  blank.totalPages = pageResult.totalPages;
  blank.filteredPages = pageResult.pages.length;

  if (pageResult.pages.length === 0) {
    return { ...blank, status: "no_pages", errorMessage: "no consultant pages above keyword threshold" };
  }

  const extractResult = await extractConsultantsFromText({
    excerptText: pageResult.extractedText,
    planName,
    fiscalYearEnd: doc.meeting_date,
    masterList: masterList.map((m) => ({
      canonical_name: m.canonical_name,
      name_aliases: m.name_aliases,
      default_specialties: m.default_specialties,
    })),
    retainedPages: pageResult.pages,
    totalPages: pageResult.totalPages,
  });

  const consultants = extractResult.response.consultants;
  blank.consultantsExtracted = consultants.length;
  blank.tokensUsed = extractResult.tokensUsed;
  blank.inputTokens = extractResult.inputTokens;
  blank.outputTokens = extractResult.outputTokens;

  let inserted = 0;
  let updated = 0;
  const nonMasterSkipped: PerPlanResult["nonMasterListSkipped"] = [];

  for (const c of consultants) {
    const matched = resolveCanonicalEntry(c.name_as_written, masterList);
    if (!matched) {
      nonMasterSkipped.push({
        name: c.name_as_written,
        mandate: c.mandate_type,
        fee_usd: c.fee_usd,
      });
      continue;
    }

    if (dryRun) {
      // In dry-run mode, count would-be inserts without writing
      inserted++;
      continue;
    }

    // ON CONFLICT DO UPDATE per the unique-mandate-year constraint
    // (plan_consultants_unique_mandate_year, NULLS NOT DISTINCT). The
    // (xmax = 0) trick distinguishes inserted vs updated rows.
    const r = await pgClient.query<{ inserted: boolean }>(
      `insert into public.plan_consultants (
         plan_id, consultant_id, mandate_type, fee_usd, fee_year,
         source_document_id, source_excerpt, source_type
       ) values ($1, $2, $3, $4, $5, $6, $7, 'cafr_extraction')
       on conflict (plan_id, consultant_id, mandate_type, fee_year)
       do update set
         fee_usd = excluded.fee_usd,
         source_excerpt = excluded.source_excerpt,
         source_document_id = excluded.source_document_id,
         updated_at = now()
       returning (xmax = 0) as inserted`,
      [
        doc.plan_id,
        matched.id,
        c.mandate_type,
        c.fee_usd,
        c.fee_year,
        docId,
        c.source_excerpt,
      ],
    );
    if (r.rows[0]?.inserted) inserted++;
    else updated++;
  }

  return {
    ...blank,
    consultantsInsertedOrUpdated: inserted + updated,
    inserted,
    updated,
    nonMasterListSkipped: nonMasterSkipped,
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`Mode: ${dryRun ? "DRY-RUN (no DB writes)" : "APPLY (inserts to plan_consultants)"}`);
  console.log(`Plans to process: ${DOCS.length}`);
  console.log("");

  if (!process.env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL not set");

  const supabase = createSupabaseAdminClient();
  const pgClient = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await pgClient.connect();

  let masterList: MasterListEntryWithId[];
  try {
    masterList = await loadMasterListWithIds(supabase);
  } catch (e) {
    await pgClient.end();
    throw e;
  }
  console.log(`Master list: ${masterList.length} consultants loaded`);
  console.log("");

  const results: PerPlanResult[] = [];

  try {
    for (const { docId, planName } of DOCS) {
      console.log(`=== ${planName} (${docId}) ===`);
      const t0 = Date.now();
      let r: PerPlanResult;
      try {
        r = await processOnePlan(supabase, pgClient, docId, planName, masterList, dryRun);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        r = {
          planName,
          docId,
          status: "error",
          errorMessage: msg,
          totalPages: 0,
          filteredPages: 0,
          consultantsExtracted: 0,
          consultantsInsertedOrUpdated: 0,
          inserted: 0,
          updated: 0,
          nonMasterListSkipped: [],
          tokensUsed: 0,
          inputTokens: 0,
          outputTokens: 0,
        };
      }
      const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
      results.push(r);

      console.log(`  status:                ${r.status}`);
      if (r.errorMessage) console.log(`  error:                 ${r.errorMessage}`);
      console.log(`  pages:                 ${r.filteredPages}/${r.totalPages} retained`);
      console.log(`  consultants extracted: ${r.consultantsExtracted}`);
      console.log(`  inserted:              ${r.inserted}`);
      console.log(`  updated:               ${r.updated}`);
      console.log(`  non-master skipped:    ${r.nonMasterListSkipped.length}`);
      for (const ns of r.nonMasterListSkipped) {
        const fee = ns.fee_usd != null ? `$${ns.fee_usd.toLocaleString()}` : "no fee";
        console.log(`    - "${ns.name}" (mandate=${ns.mandate}, ${fee})`);
      }
      console.log(`  tokens:                ${r.tokensUsed} (in=${r.inputTokens} out=${r.outputTokens})`);
      console.log(`  elapsed:               ${elapsedSec}s`);
      console.log("");
    }
  } finally {
    await pgClient.end();
  }

  const completed = results.filter((r) => r.status === "complete");
  const errored = results.filter((r) => r.status === "error");
  const noPages = results.filter((r) => r.status === "no_pages");
  const totalInserted = results.reduce((acc, r) => acc + r.inserted, 0);
  const totalUpdated = results.reduce((acc, r) => acc + r.updated, 0);
  const totalSkipped = results.reduce((acc, r) => acc + r.nonMasterListSkipped.length, 0);
  const totalInTokens = results.reduce((acc, r) => acc + r.inputTokens, 0);
  const totalOutTokens = results.reduce((acc, r) => acc + r.outputTokens, 0);
  const totalTokens = results.reduce((acc, r) => acc + r.tokensUsed, 0);
  const estCostUsd = (totalInTokens / 1_000_000) * 3 + (totalOutTokens / 1_000_000) * 15;

  console.log("=== AGGREGATE SUMMARY ===");
  console.log(`Plans processed:       ${results.length}`);
  console.log(`  complete:            ${completed.length}`);
  console.log(`  no consultant pages: ${noPages.length}`);
  console.log(`  errored:             ${errored.length}`);
  console.log("");
  console.log(`Plan-consultants rows inserted: ${totalInserted}`);
  console.log(`Plan-consultants rows updated:  ${totalUpdated}`);
  console.log(`Non-master-list skipped:        ${totalSkipped}`);
  console.log("");
  console.log(`Tokens: ${totalTokens} (in=${totalInTokens} out=${totalOutTokens})`);
  console.log(`Estimated Anthropic cost: $${estCostUsd.toFixed(2)}`);

  if (errored.length > 0) {
    console.log("");
    console.log("Errored plans (will need manual investigation):");
    for (const e of errored) {
      console.log(`  - ${e.planName}: ${e.errorMessage}`);
    }
  }

  if (dryRun) {
    console.log("");
    console.log("DRY-RUN complete. Re-run without --dry-run to commit.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
