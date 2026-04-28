/**
 * Workstream 2 Phase A Block 2: test harness for the v1.5-consultants
 * classifier.
 *
 * Pipeline (read-only, no DB writes):
 *   1. Look up doc by id (storage_path, source_url, meeting_date, plan_id).
 *   2. Look up plan name.
 *   3. Download PDF bytes from Supabase Storage.
 *   4. Run extractConsultantPages keyword filter -> ~5-10 retained pages.
 *   5. Load consultants master list (18 firms).
 *   6. Call extractConsultantsFromText.
 *   7. Post-process: match each name_as_written against master-list
 *      aliases to populate matched_canonical_name; surface unmatched
 *      extractions for human review.
 *   8. Print structured JSON to stdout.
 *
 * Default doc is CalPERS aff53f2a (FY2025 ACFR, 30.42 MB). Pass an
 * alternate doc id as a positional CLI arg to test other plans.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/test-consultant-classifier.ts
 *   pnpm tsx --env-file=.env.local scripts/test-consultant-classifier.ts <doc_id>
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { extractConsultantPages } from "@/lib/classifier/extract-consultant-pages";
import { extractConsultantsFromText } from "@/lib/classifier/extract-consultants";
import { resolveCanonicalName } from "@/lib/classifier/match-consultant";
import type { MasterListEntry } from "@/lib/classifier/prompts/consultants";

const DEFAULT_DOC_ID = "aff53f2a-a761-475b-9929-5014a99592cc"; // CalPERS FY2025 ACFR

type DocRow = {
  id: string;
  plan_id: string | null;
  storage_path: string | null;
  source_url: string | null;
  meeting_date: string | null;
  document_type: string | null;
};

type PlanRow = {
  id: string;
  name: string;
};

async function loadMasterList(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
): Promise<MasterListEntry[]> {
  const { data, error } = await supabase
    .from("consultants")
    .select("canonical_name, name_aliases, default_specialties")
    .order("canonical_name");
  if (error) throw new Error(`master list query failed: ${error.message}`);
  return (data ?? []) as MasterListEntry[];
}

async function main() {
  const docId = process.argv[2] ?? DEFAULT_DOC_ID;
  const supabase = createSupabaseAdminClient();

  const { data: doc, error: docErr } = await supabase
    .from("documents")
    .select("id, plan_id, storage_path, source_url, meeting_date, document_type")
    .eq("id", docId)
    .single();
  if (docErr || !doc) {
    console.error(`document not found: ${docErr?.message ?? "no doc"}`);
    process.exit(1);
  }
  const docRow = doc as DocRow;

  if (!docRow.plan_id) {
    console.error(`document has no plan_id: ${docId}`);
    process.exit(1);
  }
  if (!docRow.storage_path) {
    console.error(
      `document has null storage_path (oversized via Files API): ${docId}\n` +
        `Block 2 only supports the unpdf-text pipeline. Files API support is deferred to Block 2.5.`,
    );
    process.exit(1);
  }

  const { data: plan, error: planErr } = await supabase
    .from("plans")
    .select("id, name")
    .eq("id", docRow.plan_id)
    .single();
  if (planErr || !plan) {
    console.error(`plan not found: ${planErr?.message ?? "no plan"}`);
    process.exit(1);
  }
  const planRow = plan as PlanRow;

  process.stderr.write(`[1/6] Downloading PDF from Storage...\n`);
  const { data: blob, error: dlErr } = await supabase.storage
    .from("documents")
    .download(docRow.storage_path);
  if (dlErr || !blob) {
    console.error(`storage download failed: ${dlErr?.message ?? "no blob"}`);
    process.exit(1);
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  process.stderr.write(`      ${(bytes.length / 1024 / 1024).toFixed(2)} MB downloaded\n`);

  process.stderr.write(`[2/6] Extracting consultant pages via unpdf + keyword filter...\n`);
  let pageResult: Awaited<ReturnType<typeof extractConsultantPages>>;
  try {
    pageResult = await extractConsultantPages(bytes);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`unpdf parse failed: ${msg}`);
    console.error(
      `Block 2 cannot proceed - extraction requires successful unpdf parse. Files API fallback deferred to Block 2.5.`,
    );
    process.exit(1);
  }
  process.stderr.write(
    `      ${pageResult.totalPages} total pages, ${pageResult.pages.length} retained\n`,
  );

  if (pageResult.pages.length === 0) {
    console.error(
      `no pages above score threshold - document may be Category B (aggregated disclosure) or the keyword set needs tuning`,
    );
    // Still emit a structured response with zero consultants.
    const empty = {
      doc_id: docRow.id,
      plan_name: planRow.name,
      fiscal_year_end: docRow.meeting_date,
      extraction_method: "unpdf_text_filter",
      total_pages: pageResult.totalPages,
      filtered_pages: [],
      filtered_pages_score: [],
      tokens_used: 0,
      consultants_extracted: [],
      unmatched_extractions: [],
    };
    console.log(JSON.stringify(empty, null, 2));
    return;
  }

  process.stderr.write(`[3/6] Loading master consultants list...\n`);
  const masterList = await loadMasterList(supabase);
  process.stderr.write(`      ${masterList.length} firms loaded\n`);

  process.stderr.write(`[4/6] Calling v1.5-consultants classifier...\n`);
  const extractResult = await extractConsultantsFromText({
    excerptText: pageResult.extractedText,
    planName: planRow.name,
    fiscalYearEnd: docRow.meeting_date,
    masterList,
    retainedPages: pageResult.pages,
    totalPages: pageResult.totalPages,
  });
  process.stderr.write(
    `      ${extractResult.response.consultants.length} consultants extracted, ${extractResult.tokensUsed} tokens\n`,
  );

  process.stderr.write(`[5/6] Resolving names against master list...\n`);
  const enriched = extractResult.response.consultants.map((c) => ({
    ...c,
    matched_canonical_name: resolveCanonicalName(c.name_as_written, masterList),
  }));
  const unmatched = enriched
    .filter((c) => c.matched_canonical_name == null)
    .map((c) => c.name_as_written);

  process.stderr.write(`[6/6] Done. Emitting JSON.\n\n`);

  const output = {
    doc_id: docRow.id,
    plan_name: planRow.name,
    fiscal_year_end: docRow.meeting_date,
    extraction_method: "unpdf_text_filter",
    total_pages: pageResult.totalPages,
    filtered_pages: pageResult.pages,
    filtered_pages_score: pageResult.pageScores,
    tokens_used: extractResult.tokensUsed,
    input_tokens: extractResult.inputTokens,
    output_tokens: extractResult.outputTokens,
    stop_reason: extractResult.stopReason,
    consultants_extracted: enriched,
    unmatched_extractions: unmatched,
  };
  console.log(JSON.stringify(output, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
