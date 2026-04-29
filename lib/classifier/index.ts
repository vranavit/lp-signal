import { PDFDocument } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CLASSIFIER_MODEL,
  extractSignalsFromPdf,
  extractSignalsFromPdfFile,
  extractSignalsFromText,
  extractSignalsFromPlanPressReleaseText,
  extractSignalsFromAgendaExcerpt,
  extractAllocationsFromCafrPdf,
  extractAllocationsFromCafrPdfFile,
  extractAllocationsFromCafrText,
  extractIpsAllocationsFromText,
  type ExtractResult,
} from "./extract";
import {
  extractCommitmentPages,
  extractPdfTextFallback,
} from "./extract-commitment-pages";
import {
  FILES_API_THRESHOLD_BYTES,
  uploadPdfToFilesApi,
  deleteFileFromFilesApi,
} from "./files-api";
import { PROMPT_VERSION } from "./prompt";
import { GP_PROMPT_VERSION } from "./prompts/gp-press-release";
import { PRESS_RELEASE_PROMPT_VERSION } from "./prompts/press-release";
import { CAFR_PROMPT_VERSION } from "./prompts/cafr-allocation";
import { IPS_PROMPT_VERSION } from "./prompts/ips";
import type { IpsAllocation } from "./schemas/ips";
import { computePriorityScore } from "./score";
import type { ClassifiedSignal } from "./schema";
import type { CafrAllocation } from "./schemas/cafr-allocation";
import { verifyAllocationsForPlan } from "../predictive/verify-cross-source";

const STORAGE_BUCKET = "documents";
// Board-packet PDFs (Oregon "Public Book", MA PRIM full minutes) routinely
// run 100–250 pages. The prior 100-page cap excluded 17 Session-2 docs
// despite the CAFR path already proving 300+ page PDFs work against
// Anthropic (see CAFR_MAX_PAGES note below). 300 covers the full Session-2
// range (max observed 252) with a ~140-page buffer below the CAFR-proven
// ceiling. Anthropic will return a request-size / token-overflow error on
// the rare doc that exceeds its per-call budget — those surface as
// distinct error_message values, not silent truncation.
const MAX_PAGES = 300;
// CAFRs run 150–300 pages typically; NYSCRF's is 310 and CalPERS' Annual
// Investment Report is 440. Allow up to 500 for document_type === 'cafr'.
// The Anthropic 32 MB request limit is still the hard ceiling — documents
// larger than that are swapped to a smaller investment-focused companion.
const CAFR_MAX_PAGES = 500;

// Confidence-tiered routing for CAFR allocations — mirrors the signals tier
// thresholds so users see the same Accept / Preliminary / Rejected buckets.
const ALLOCATION_ACCEPT_CONFIDENCE = 0.85;
const ALLOCATION_PRELIMINARY_CONFIDENCE = 0.7;

// Confidence-tiered routing (see docs/proposals/confidence-tiered-auto-approval.md
// and supabase/migrations/20260421000009_signals_preliminary.sql).
const ACCEPT_CONFIDENCE = 0.85;
const PRELIMINARY_CONFIDENCE = 0.70;
const ACCEPT_PRIORITY = 40;

// Transcripts are verbatim meeting recordings — routinely 200+ pages and low
// signal density. Phase 2 decision: skip them. Phase 3 will revisit with
// chunking. Detection is URL-based (CalPERS uses "transcript" in the slug).
const OUT_OF_SCOPE_URL_PATTERNS = [/\btranscript\b/i];

export type ClassifyOutcome = {
  documentId: string;
  ok: boolean;
  reason?: string;
  signalsExtracted: number;
  signalsInserted: number;
  signalsAccepted: number;
  signalsPreliminary: number;
  signalsRejected: number;
  tokensUsed: number;
  pages?: number;
  confidences?: number[];
};

export async function classifyDocument(
  supabase: SupabaseClient,
  documentId: string,
): Promise<ClassifyOutcome> {
  const { data: doc, error: docErr } = await supabase
    .from("documents")
    .select(
      "id, plan_id, gp_id, document_type, storage_path, content_text, meeting_date, processing_status, source_url, plan:plans(id, name, tier), gp:gps(id, name)",
    )
    .eq("id", documentId)
    .maybeSingle();

  if (docErr || !doc) {
    return {
      documentId,
      ok: false,
      reason: docErr?.message ?? "document_not_found",
      signalsExtracted: 0,
      signalsInserted: 0,
      signalsAccepted: 0,
      signalsPreliminary: 0,
      signalsRejected: 0,
      tokensUsed: 0,
    };
  }

  if (doc.processing_status !== "pending") {
    return {
      documentId,
      ok: false,
      reason: `skip_status_${doc.processing_status}`,
      signalsExtracted: 0,
      signalsInserted: 0,
      signalsAccepted: 0,
      signalsPreliminary: 0,
      signalsRejected: 0,
      tokensUsed: 0,
    };
  }

  const plan = doc.plan as unknown as {
    id: string;
    name: string;
    tier: number | null;
  } | null;
  const gp = doc.gp as unknown as { id: string; name: string } | null;

  const isGpPressRelease = doc.document_type === "gp_press_release";
  const isPlanPressRelease = doc.document_type === "press_release";
  const isCafr = doc.document_type === "cafr";
  const isInvestmentPolicy = doc.document_type === "investment_policy";

  // Pre-flight validation (before marking status = processing). Per-route:
  //   PDF (board minutes / agenda packet / CAFR): requires plan + non-transcript URL.
  //   GP press release (text): requires gp + content_text.
  //   Plan press release (text): requires plan + content_text.
  //   IPS (text): requires plan + content_text (text extracted at scrape time).
  if (isInvestmentPolicy) {
    if (!plan || !doc.content_text) {
      await supabase
        .from("documents")
        .update({
          processing_status: "error",
          error_message: !plan
            ? "ips_requires_plan"
            : "ips_missing_content_text",
          processed_at: new Date().toISOString(),
        })
        .eq("id", documentId);
      return {
        documentId,
        ok: false,
        reason: !plan ? "missing_plan" : "missing_content_text",
        signalsExtracted: 0,
        signalsInserted: 0,
        signalsAccepted: 0,
        signalsPreliminary: 0,
        signalsRejected: 0,
        tokensUsed: 0,
      };
    }
  } else if (isGpPressRelease) {
    if (!gp || !doc.content_text) {
      await supabase
        .from("documents")
        .update({
          processing_status: "error",
          error_message: !gp
            ? "press_release_requires_gp"
            : "press_release_missing_content_text",
          processed_at: new Date().toISOString(),
        })
        .eq("id", documentId);
      return {
        documentId,
        ok: false,
        reason: !gp ? "missing_gp" : "missing_content_text",
        signalsExtracted: 0,
        signalsInserted: 0,
        signalsAccepted: 0,
        signalsPreliminary: 0,
        signalsRejected: 0,
        tokensUsed: 0,
      };
    }
  } else if (isPlanPressRelease) {
    if (!plan || !doc.content_text) {
      await supabase
        .from("documents")
        .update({
          processing_status: "error",
          error_message: !plan
            ? "plan_press_release_requires_plan"
            : "plan_press_release_missing_content_text",
          processed_at: new Date().toISOString(),
        })
        .eq("id", documentId);
      return {
        documentId,
        ok: false,
        reason: !plan ? "missing_plan" : "missing_content_text",
        signalsExtracted: 0,
        signalsInserted: 0,
        signalsAccepted: 0,
        signalsPreliminary: 0,
        signalsRejected: 0,
        tokensUsed: 0,
      };
    }
  } else {
    const outOfScope = OUT_OF_SCOPE_URL_PATTERNS.find((re) =>
      re.test(doc.source_url ?? ""),
    );
    if (outOfScope) {
      await supabase
        .from("documents")
        .update({
          processing_status: "error",
          error_message: `out_of_scope: transcript`,
          processed_at: new Date().toISOString(),
        })
        .eq("id", documentId);
      return {
        documentId,
        ok: false,
        reason: "out_of_scope",
        signalsExtracted: 0,
        signalsInserted: 0,
        signalsAccepted: 0,
        signalsPreliminary: 0,
        signalsRejected: 0,
        tokensUsed: 0,
      };
    }

    if (!plan) {
      await supabase
        .from("documents")
        .update({
          processing_status: "error",
          error_message: "pdf_flow_requires_plan_id",
          processed_at: new Date().toISOString(),
        })
        .eq("id", documentId);
      return {
        documentId,
        ok: false,
        reason: "missing_plan",
        signalsExtracted: 0,
        signalsInserted: 0,
        signalsAccepted: 0,
        signalsPreliminary: 0,
        signalsRejected: 0,
        tokensUsed: 0,
      };
    }
  }

  await supabase
    .from("documents")
    .update({ processing_status: "processing" })
    .eq("id", documentId);

  try {
    // CAFR path diverges early — it writes to pension_allocations, not signals.
    if (isCafr) {
      return await classifyCafr(supabase, doc, plan as { id: string; name: string; tier: number | null });
    }

    // IPS path also writes to pension_allocations (target rows only). Text
    // is already extracted at scrape time, so no PDF round-trip here.
    if (isInvestmentPolicy) {
      return await classifyIps(
        supabase,
        doc,
        plan as { id: string; name: string },
      );
    }

    let extract: ExtractResult;
    let pageCount: number | undefined;

    if (isGpPressRelease) {
      extract = await extractSignalsFromText({
        text: doc.content_text as string,
        gpName: (gp as { id: string; name: string }).name,
        publishedAt: doc.meeting_date,
      });
    } else if (isPlanPressRelease) {
      extract = await extractSignalsFromPlanPressReleaseText({
        text: doc.content_text as string,
        planName: (plan as { name: string }).name,
        publishedAt: doc.meeting_date,
      });
    } else {
      if (!doc.storage_path) throw new Error("document has no storage_path");

      const { data: blob, error: dlErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .download(doc.storage_path);
      if (dlErr || !blob) {
        throw new Error(
          `storage download failed: ${dlErr?.message ?? "no blob"}`,
        );
      }

      const bytes = new Uint8Array(await blob.arrayBuffer());

      // Agenda packets (LACERA today) are typically 400-750 pages and
      // don't fit the 300-page full-PDF path. We route them through the
      // keyword-page extractor before the MAX_PAGES gate so the few
      // pages that actually contain commitment votes can still surface
      // signals. See lib/classifier/extract-commitment-pages.ts.
      const isAgendaPacket = doc.document_type === "agenda_packet";

      // pdf-lib is strict about cross-reference structure and rejects a
      // growing set of legitimate PDFs that Anthropic / pdfjs parse
      // fine (Minnesota SBI meeting books, Colorado PERA full ACFRs).
      // When the first parse fails with the telltale PDFDict error we
      // retry with unpdf (pdfjs) and route the extracted text through
      // the same agenda-excerpt path used for LACERA. This preserves
      // the full-PDF base64 path for the common case — only unparseable
      // docs pay the text-extract round-trip.
      let parsedPageCount = 0;
      let pdfLibFailure: Error | null = null;
      try {
        const pdf = await PDFDocument.load(bytes, {
          ignoreEncryption: true,
          throwOnInvalidObject: false,
        });
        parsedPageCount = pdf.getPageCount();
      } catch (err) {
        pdfLibFailure = err instanceof Error ? err : new Error(String(err));
      }

      if (pdfLibFailure && !isPdfLibParseRecoverable(pdfLibFailure)) {
        throw new Error(`pdf_parse_failed: ${pdfLibFailure.message}`);
      }

      if (isAgendaPacket) {
        const extracted = await extractCommitmentPages(bytes);
        pageCount = extracted.totalPages;
        if (extracted.pages.length === 0) {
          await supabase
            .from("documents")
            .update({
              processing_status: "complete",
              error_message: `no_commitment_content_in_agenda: ${extracted.totalPages} pages scanned, 0 above threshold`,
              processed_at: new Date().toISOString(),
            })
            .eq("id", documentId);
          return {
            documentId,
            ok: false,
            reason: "no_commitment_content_in_agenda",
            signalsExtracted: 0,
            signalsInserted: 0,
            signalsAccepted: 0,
            signalsPreliminary: 0,
            signalsRejected: 0,
            tokensUsed: 0,
            pages: extracted.totalPages,
          };
        }
        extract = await extractSignalsFromAgendaExcerpt({
          excerptText: extracted.extractedText,
          planName: (plan as { name: string }).name,
          meetingDate: doc.meeting_date,
          retainedPages: extracted.pages,
          totalPages: extracted.totalPages,
        });
      } else if (pdfLibFailure) {
        console.log(
          `[classifier] pdf-lib failed for ${documentId}, falling back to unpdf (${pdfLibFailure.message.slice(0, 60)})`,
        );
        let extracted: Awaited<ReturnType<typeof extractPdfTextFallback>>;
        try {
          extracted = await extractPdfTextFallback(bytes, {
            maxPagesAll: MAX_PAGES,
          });
        } catch (unpdfErr) {
          const msg =
            unpdfErr instanceof Error ? unpdfErr.message : String(unpdfErr);
          throw new Error(
            `pdf_parse_failed_both: pdf-lib=${pdfLibFailure.message.slice(0, 60)}; unpdf=${msg.slice(0, 60)}`,
          );
        }
        pageCount = extracted.totalPages;
        if (extracted.pages.length === 0) {
          await supabase
            .from("documents")
            .update({
              processing_status: "complete",
              error_message: `no_commitment_content_unpdf_fallback: ${extracted.totalPages} pages scanned, 0 above threshold`,
              processed_at: new Date().toISOString(),
            })
            .eq("id", documentId);
          return {
            documentId,
            ok: false,
            reason: "no_commitment_content_unpdf_fallback",
            signalsExtracted: 0,
            signalsInserted: 0,
            signalsAccepted: 0,
            signalsPreliminary: 0,
            signalsRejected: 0,
            tokensUsed: 0,
            pages: extracted.totalPages,
          };
        }
        console.log(
          `[classifier] unpdf fallback for ${documentId}: totalPages=${extracted.totalPages} retained=${extracted.pages.length} keywordFilter=${extracted.usedKeywordFilter}`,
        );
        extract = await extractSignalsFromAgendaExcerpt({
          excerptText: extracted.extractedText,
          planName: (plan as { name: string }).name,
          meetingDate: doc.meeting_date,
          retainedPages: extracted.pages,
          totalPages: extracted.totalPages,
        });
      } else {
        if (parsedPageCount > MAX_PAGES) {
          await supabase
            .from("documents")
            .update({
              processing_status: "error",
              error_message: `too_long: ${parsedPageCount} pages (max ${MAX_PAGES})`,
              processed_at: new Date().toISOString(),
            })
            .eq("id", documentId);
          return {
            documentId,
            ok: false,
            reason: "too_long",
            signalsExtracted: 0,
            signalsInserted: 0,
            signalsAccepted: 0,
            signalsPreliminary: 0,
            signalsRejected: 0,
            tokensUsed: 0,
            pages: parsedPageCount,
          };
        }

        pageCount = parsedPageCount;

        if (bytes.length > FILES_API_THRESHOLD_BYTES) {
          extract = await classifyPdfViaFilesApi(bytes, documentId, async (fileId) =>
            extractSignalsFromPdfFile({
              fileId,
              planName: (plan as { name: string }).name,
              meetingDate: doc.meeting_date,
            }),
          );
        } else {
          const pdfBase64 = Buffer.from(bytes).toString("base64");
          extract = await extractSignalsFromPdf({
            pdfBase64,
            planName: (plan as { name: string }).name,
            meetingDate: doc.meeting_date,
          });
        }
      }
    }

    const { response, tokensUsed } = extract;

    // Origin bundles the provenance each row needs to be written correctly.
    // Plan-side rows (PDF, plan press release) carry plan_id; GP-side rows
    // (gp_press_release only) carry gp_id. Never both.
    const origin = {
      plan_id: isGpPressRelease ? null : (plan as { id: string }).id,
      gp_id: isGpPressRelease ? (gp as { id: string }).id : null,
      plan_tier: isGpPressRelease
        ? null
        : (plan as { tier: number | null }).tier,
      prompt_version: isGpPressRelease
        ? GP_PROMPT_VERSION
        : isPlanPressRelease
          ? PRESS_RELEASE_PROMPT_VERSION
          : PROMPT_VERSION,
    };

    const signalRows: ReturnType<typeof buildSignalRow>[] = [];
    const rejectedRows: ReturnType<typeof buildRejectedRow>[] = [];
    let acceptedCount = 0;
    let preliminaryCount = 0;

    for (const s of response.signals) {
      if (s.confidence < PRELIMINARY_CONFIDENCE) {
        rejectedRows.push(buildRejectedRow(s, doc, origin, "low_confidence"));
        continue;
      }
      const row = buildSignalRow(s, doc, origin);
      const isAccepted =
        s.confidence >= ACCEPT_CONFIDENCE && row.priority_score >= ACCEPT_PRIORITY;
      row.preliminary = !isAccepted;
      if (isAccepted) acceptedCount++;
      else preliminaryCount++;
      signalRows.push(row);
    }

    // Split T1 rows from T2/T3 because T1 has a unique partial index
    // (signals_t1_natural_key_idx, migration 20260501000015) that can fire
    // when the same commitment is mentioned in multiple source documents.
    // We insert T1 rows one at a time and treat unique-violation (PostgreSQL
    // error 23505) as a silent skip — the natural-key dedup is intentional.
    // T2 / T3 rows have no such index and stay on the batch path.
    let insertedCount = 0;
    let t1Skipped = 0;
    if (signalRows.length > 0) {
      const t1Rows = signalRows.filter((r) => r.signal_type === 1);
      const otherRows = signalRows.filter((r) => r.signal_type !== 1);

      for (const row of t1Rows) {
        const { error: insErr } = await supabase.from("signals").insert(row);
        if (insErr) {
          // Postgres error code 23505 = unique_violation. Surfaces in
          // PostgREST as { code: '23505', ... }.
          if (insErr.code === "23505") {
            t1Skipped++;
            continue;
          }
          throw new Error(`signal_insert_failed: ${insErr.message}`);
        }
        insertedCount++;
      }

      if (otherRows.length > 0) {
        const { error: insErr, count } = await supabase
          .from("signals")
          .insert(otherRows, { count: "exact" });
        if (insErr) throw new Error(`signal_insert_failed: ${insErr.message}`);
        insertedCount += count ?? otherRows.length;
      }

      if (t1Skipped > 0) {
        console.log(
          `[classifier] doc=${doc.id} skipped ${t1Skipped} T1 row(s) on natural-key conflict (already captured from another document)`,
        );
      }
    }

    if (rejectedRows.length > 0) {
      const { error: rejErr } = await supabase
        .from("rejected_signals")
        .insert(rejectedRows);
      // A rejection-log failure shouldn't poison document completion — the
      // signals that did land are still correct. Log and keep going.
      if (rejErr) {
        console.warn(
          `rejected_signals_insert_failed doc=${doc.id}: ${rejErr.message}`,
        );
      }
    }

    await supabase
      .from("documents")
      .update({
        processing_status: "complete",
        processed_at: new Date().toISOString(),
        api_tokens_used: tokensUsed,
        error_message: null,
      })
      .eq("id", documentId);

    return {
      documentId,
      ok: true,
      signalsExtracted: response.signals.length,
      signalsInserted: insertedCount,
      signalsAccepted: acceptedCount,
      signalsPreliminary: preliminaryCount,
      signalsRejected: rejectedRows.length,
      tokensUsed,
      pages: pageCount,
      confidences: response.signals.map((s) => s.confidence),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from("documents")
      .update({
        processing_status: "error",
        processed_at: new Date().toISOString(),
        error_message: message.slice(0, 1000),
      })
      .eq("id", documentId);
    return {
      documentId,
      ok: false,
      reason: message,
      signalsExtracted: 0,
      signalsInserted: 0,
      signalsAccepted: 0,
      signalsPreliminary: 0,
      signalsRejected: 0,
      tokensUsed: 0,
    };
  }
}

type Origin = {
  plan_id: string | null;
  gp_id: string | null;
  plan_tier: number | null;
  prompt_version: string;
};

function buildSignalRow(
  s: ClassifiedSignal,
  doc: { id: string; meeting_date: string | null },
  origin: Origin,
) {
  const amountForScore =
    s.type === 1
      ? s.fields.amount_usd
      : s.type === 2
      ? s.fields.implied_delta_usd ?? null
      : s.fields.new_year_pacing_usd;

  const priority_score = computePriorityScore({
    type: s.type,
    amount_usd: amountForScore ?? null,
    plan_tier: origin.plan_tier,
    meeting_date: doc.meeting_date,
  });

  // All auto-routed rows are stamped validated_at at insert time — there is
  // no longer a pending-review queue. The `preliminary` flag is set by the
  // caller after priority_score is known.
  return {
    document_id: doc.id,
    plan_id: origin.plan_id,
    gp_id: origin.gp_id,
    signal_type: s.type,
    confidence: s.confidence,
    priority_score,
    asset_class: s.fields.asset_class,
    summary: s.summary,
    fields: s.fields,
    source_page: s.source_page,
    source_quote: s.source_quote,
    commitment_amount_usd: s.type === 1 ? s.fields.amount_usd : null,
    seed_data: false,
    validated_at: new Date().toISOString(),
    preliminary: false,
    prompt_version: origin.prompt_version,
  };
}

function buildRejectedRow(
  s: ClassifiedSignal,
  doc: { id: string },
  origin: Origin,
  rejection_reason: string,
) {
  return {
    document_id: doc.id,
    plan_id: origin.plan_id,
    gp_id: origin.gp_id,
    signal_type: s.type,
    confidence: s.confidence,
    asset_class: s.fields.asset_class,
    summary: s.summary,
    fields: s.fields,
    source_page: s.source_page,
    source_quote: s.source_quote,
    rejection_reason,
    model_version: CLASSIFIER_MODEL,
    prompt_version: origin.prompt_version,
  };
}

// ── CAFR allocation extraction ──────────────────────────────────────────────
// Writes to pension_allocations (not signals). Reuses the same auto-approval
// confidence bands; allocations in the 0.70–0.85 band land as preliminary=true.
// Sub-0.70 rows are dropped with a console warning (no dedicated
// rejected_allocations table — add only if drift analysis demands it).

type CafrDoc = {
  id: string;
  plan_id: string;
  storage_path: string | null;
  meeting_date: string | null;
  source_url: string | null;
};

async function classifyCafr(
  supabase: SupabaseClient,
  doc: CafrDoc,
  plan: { id: string; name: string; tier: number | null },
): Promise<ClassifyOutcome> {
  if (!doc.storage_path) {
    await markDocError(supabase, doc.id, "cafr_missing_storage_path");
    return zeroOutcome(doc.id, "cafr_missing_storage_path");
  }

  const { data: blob, error: dlErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .download(doc.storage_path);
  if (dlErr || !blob) {
    throw new Error(`storage download failed: ${dlErr?.message ?? "no blob"}`);
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return classifyCafrFromBytes(supabase, doc, plan, bytes);
}

/**
 * Public entry for CAFR classification when the PDF bytes are already
 * in memory (oversized ingest path that bypasses Supabase storage
 * because the file exceeds the 50 MB project cap — Colorado PERA
 * FY2024 ACFR is 84 MB). Same logic as classifyCafr post-download:
 * pdf-lib → unpdf fallback → base64 vs Files API based on size.
 */
export async function classifyCafrFromBytes(
  supabase: SupabaseClient,
  doc: CafrDoc,
  plan: { id: string; name: string; tier: number | null },
  bytes: Uint8Array,
): Promise<ClassifyOutcome> {
  let pageCount = 0;
  let pdfLibFailure: Error | null = null;
  try {
    const pdf = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      throwOnInvalidObject: false,
    });
    pageCount = pdf.getPageCount();
  } catch (err) {
    pdfLibFailure = err instanceof Error ? err : new Error(String(err));
  }

  if (pdfLibFailure && !isPdfLibParseRecoverable(pdfLibFailure)) {
    throw new Error(`cafr_pdf_parse_failed: ${pdfLibFailure.message}`);
  }

  // Route by size first — oversized PDFs go through Anthropic's Files
  // API regardless of whether pdf-lib parsed the cross-reference
  // structure, because Anthropic's server-side PDF parser preserves
  // table layout better than unpdf's text extraction (critical for
  // allocation-policy tables). Only if Files API fails do we fall
  // back to unpdf text.
  let extract: Awaited<ReturnType<typeof extractAllocationsFromCafrPdf>>;

  if (bytes.length > FILES_API_THRESHOLD_BYTES) {
    if (!pdfLibFailure && pageCount > CAFR_MAX_PAGES) {
      await markDocError(
        supabase,
        doc.id,
        `too_long: ${pageCount} pages (max ${CAFR_MAX_PAGES})`,
      );
      return { ...zeroOutcome(doc.id, "too_long"), pages: pageCount };
    }
    try {
      extract = await classifyPdfViaFilesApi(bytes, doc.id, async (fileId) =>
        extractAllocationsFromCafrPdfFile({
          fileId,
          planName: plan.name,
          fiscalYearEnd: doc.meeting_date,
        }),
      );
    } catch (filesErr) {
      const msg = filesErr instanceof Error ? filesErr.message : String(filesErr);
      console.warn(
        `[classifier/cafr] Files API path failed for ${doc.id} (${msg.slice(0, 80)}) — trying unpdf text fallback`,
      );
      // Last-resort text extraction. Page layout is lost but better
      // than silently failing on a file that Anthropic rejected.
      const fallback = await extractPdfTextFallback(bytes, {
        maxPagesAll: CAFR_MAX_PAGES,
      });
      pageCount = fallback.totalPages;
      if (fallback.pages.length === 0 || fallback.totalPages > CAFR_MAX_PAGES) {
        throw new Error(
          `cafr_oversized_fallback_failed: files_api=${msg.slice(0, 60)}; unpdf_pages=${fallback.pages.length}/${fallback.totalPages}`,
        );
      }
      extract = await extractAllocationsFromCafrText({
        excerptText: fallback.extractedText,
        planName: plan.name,
        fiscalYearEnd: doc.meeting_date,
        totalPages: fallback.totalPages,
      });
    }
  } else if (pdfLibFailure) {
    // Small but malformed — pdf-lib rejected, base64 inline path would
    // also likely fail Anthropic's server parser on the same structure.
    // Fall to unpdf text extraction (works for every PDF we've seen).
    console.log(
      `[classifier/cafr] pdf-lib failed for ${doc.id}, falling back to unpdf (${pdfLibFailure.message.slice(0, 60)})`,
    );
    let fallback: Awaited<ReturnType<typeof extractPdfTextFallback>>;
    try {
      fallback = await extractPdfTextFallback(bytes, {
        maxPagesAll: CAFR_MAX_PAGES,
      });
    } catch (unpdfErr) {
      const msg =
        unpdfErr instanceof Error ? unpdfErr.message : String(unpdfErr);
      throw new Error(
        `cafr_pdf_parse_failed_both: pdf-lib=${pdfLibFailure.message.slice(0, 60)}; unpdf=${msg.slice(0, 60)}`,
      );
    }
    pageCount = fallback.totalPages;
    if (fallback.totalPages > CAFR_MAX_PAGES) {
      await markDocError(
        supabase,
        doc.id,
        `too_long: ${fallback.totalPages} pages (max ${CAFR_MAX_PAGES})`,
      );
      return { ...zeroOutcome(doc.id, "too_long"), pages: fallback.totalPages };
    }
    console.log(
      `[classifier/cafr] unpdf fallback for ${doc.id}: totalPages=${fallback.totalPages} retained=${fallback.pages.length} keywordFilter=${fallback.usedKeywordFilter}`,
    );
    extract = await extractAllocationsFromCafrText({
      excerptText: fallback.extractedText,
      planName: plan.name,
      fiscalYearEnd: doc.meeting_date,
      totalPages: fallback.totalPages,
    });
  } else {
    if (pageCount > CAFR_MAX_PAGES) {
      await markDocError(
        supabase,
        doc.id,
        `too_long: ${pageCount} pages (max ${CAFR_MAX_PAGES})`,
      );
      return { ...zeroOutcome(doc.id, "too_long"), pages: pageCount };
    }
    const pdfBase64 = Buffer.from(bytes).toString("base64");
    extract = await extractAllocationsFromCafrPdf({
      pdfBase64,
      planName: plan.name,
      fiscalYearEnd: doc.meeting_date,
    });
  }
  const { response, tokensUsed } = extract;

  const accepted: CafrAllocation[] = [];
  const preliminary: CafrAllocation[] = [];
  const dropped: CafrAllocation[] = [];

  for (const a of response.allocations) {
    if (a.confidence < ALLOCATION_PRELIMINARY_CONFIDENCE) {
      dropped.push(a);
      continue;
    }
    if (a.confidence >= ALLOCATION_ACCEPT_CONFIDENCE) accepted.push(a);
    else preliminary.push(a);
  }

  // De-dup on (asset_class, coalesce(sub_class, '')) to match the
  // pension_allocations unique index added in Day-9.5 H-2. The
  // classifier occasionally emits the same asset class twice with a
  // null sub_class — typically when the policy table appears in the
  // Investment Section AND the Statistical Section. Keep the highest-
  // confidence row per bucket and drop the rest (with a console note
  // so drift-analysis has visibility).
  const dedupMap = new Map<string, CafrAllocation>();
  const dupDropped: CafrAllocation[] = [];
  for (const a of [...accepted, ...preliminary]) {
    const key = `${a.asset_class}::${a.sub_class ?? ""}`;
    const existing = dedupMap.get(key);
    if (!existing || a.confidence > existing.confidence) {
      if (existing) dupDropped.push(existing);
      dedupMap.set(key, a);
    } else {
      dupDropped.push(a);
    }
  }
  if (dupDropped.length > 0) {
    console.warn(
      `[classifier/cafr] deduplicated ${dupDropped.length} duplicate allocations ` +
        `(doc=${doc.id}): ${dupDropped.map((d) => `${d.asset_class}${d.sub_class ? "/" + d.sub_class : ""}@${d.confidence.toFixed(2)}`).join(", ")}`,
    );
  }
  const toInsert = [...dedupMap.values()].map((a) => ({
    plan_id: plan.id,
    as_of_date: doc.meeting_date,
    asset_class: a.asset_class,
    sub_class: a.sub_class ?? null,
    target_pct: a.target_pct,
    target_min_pct: a.target_min_pct ?? null,
    target_max_pct: a.target_max_pct ?? null,
    actual_pct: a.actual_pct ?? null,
    actual_usd: a.actual_usd ?? null,
    total_plan_aum_usd: response.total_plan_aum_usd ?? null,
    source_document_id: doc.id,
    source_page: a.source_page,
    source_quote: a.source_quote,
    confidence: a.confidence,
    preliminary: a.confidence < ALLOCATION_ACCEPT_CONFIDENCE,
    prompt_version: CAFR_PROMPT_VERSION,
  }));

  let insertedCount = 0;
  if (toInsert.length > 0) {
    const { error, count } = await supabase
      .from("pension_allocations")
      .insert(toInsert, { count: "exact" });
    if (error) throw new Error(`allocation_insert_failed: ${error.message}`);
    insertedCount = count ?? toInsert.length;
  }

  if (dropped.length > 0) {
    console.warn(
      `[classifier/cafr] dropped ${dropped.length} allocations below confidence threshold ` +
        `(doc=${doc.id}): ${dropped.map((d) => `${d.asset_class}@${d.confidence.toFixed(2)}`).join(", ")}`,
    );
  }

  // Cross-source verification post-insert hook. Idempotent: skips pairs
  // already verified at v1.1-allocation. Wrapped in try/catch so a
  // verifier failure (model timeout, transient DB error) cannot abort
  // the classifier run; the allocations are already persisted at this
  // point and the verifier can be re-run later.
  if (insertedCount > 0) {
    try {
      const v = await verifyAllocationsForPlan(supabase, { planId: plan.id });
      if (v.pairsVerified > 0 || v.errors.length > 0) {
        console.log(
          `[classifier/cafr] cross-source verification (doc=${doc.id}): ` +
            `considered=${v.pairsConsidered} new=${v.pairsVerified} ` +
            `already=${v.pairsAlreadyVerified} errors=${v.errors.length}`,
        );
      }
    } catch (e) {
      console.warn(
        `[classifier/cafr] cross-source verification threw (doc=${doc.id}): ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  await supabase
    .from("documents")
    .update({
      processing_status: "complete",
      processed_at: new Date().toISOString(),
      api_tokens_used: tokensUsed,
      error_message: null,
    })
    .eq("id", doc.id);

  return {
    documentId: doc.id,
    ok: true,
    signalsExtracted: response.allocations.length,
    signalsInserted: insertedCount,
    signalsAccepted: accepted.length,
    signalsPreliminary: preliminary.length,
    signalsRejected: dropped.length,
    tokensUsed,
    pages: pageCount,
    confidences: response.allocations.map((a) => a.confidence),
  };
}

// ── IPS allocation extraction ───────────────────────────────────────────────
// Writes target rows to pension_allocations alongside CAFR-derived rows.
// IPS rows: target_pct populated, actual_pct/actual_usd/total_plan_aum_usd
// left null. Confidence bands match the CAFR path:
//   accept ≥ 0.85 → preliminary=false
//   0.70-0.85    → preliminary=true
//   < 0.70       → dropped (console-warned, not persisted)

type IpsDoc = {
  id: string;
  plan_id: string;
  content_text: string | null;
  meeting_date: string | null;
  source_url: string | null;
  created_at?: string;
};

async function classifyIps(
  supabase: SupabaseClient,
  doc: IpsDoc,
  plan: { id: string; name: string },
): Promise<ClassifyOutcome> {
  if (!doc.content_text) {
    await markDocError(supabase, doc.id, "ips_missing_content_text");
    return zeroOutcome(doc.id, "ips_missing_content_text");
  }

  const extract = await extractIpsAllocationsFromText({
    text: doc.content_text,
    planName: plan.name,
    effectiveDateHint: doc.meeting_date,
  });
  const { response, tokensUsed } = extract;

  const accepted: IpsAllocation[] = [];
  const preliminary: IpsAllocation[] = [];
  const dropped: IpsAllocation[] = [];

  for (const a of response.target_allocations) {
    if (a.confidence < ALLOCATION_PRELIMINARY_CONFIDENCE) {
      dropped.push(a);
      continue;
    }
    if (a.confidence >= ALLOCATION_ACCEPT_CONFIDENCE) accepted.push(a);
    else preliminary.push(a);
  }

  // Dedup on (asset_class, sub_class) — same key shape as the CAFR path,
  // matches the pension_allocations partial unique index.
  const dedupMap = new Map<string, IpsAllocation>();
  const dupDropped: IpsAllocation[] = [];
  for (const a of [...accepted, ...preliminary]) {
    const key = `${a.asset_class}::${a.sub_class ?? ""}`;
    const existing = dedupMap.get(key);
    if (!existing || a.confidence > existing.confidence) {
      if (existing) dupDropped.push(existing);
      dedupMap.set(key, a);
    } else {
      dupDropped.push(a);
    }
  }
  if (dupDropped.length > 0) {
    console.warn(
      `[classifier/ips] deduplicated ${dupDropped.length} duplicate allocations ` +
        `(doc=${doc.id}): ${dupDropped.map((d) => `${d.asset_class}${d.sub_class ? "/" + d.sub_class : ""}@${d.confidence.toFixed(2)}`).join(", ")}`,
    );
  }

  // as_of_date precedence: explicit effective_date from the IPS body →
  // doc.meeting_date (if scraper populated one) → today (last resort).
  // The IPS scraper today does not populate meeting_date, so this almost
  // always falls through to effective_date or today.
  const effectiveDate =
    response.effective_date ??
    doc.meeting_date ??
    (doc.created_at ? doc.created_at.slice(0, 10) : null) ??
    new Date().toISOString().slice(0, 10);

  const toInsert = [...dedupMap.values()].map((a) => ({
    plan_id: plan.id,
    as_of_date: effectiveDate,
    asset_class: a.asset_class,
    sub_class: a.sub_class ?? null,
    target_pct: a.target_pct,
    target_min_pct: a.target_min_pct ?? null,
    target_max_pct: a.target_max_pct ?? null,
    actual_pct: null,
    actual_usd: null,
    total_plan_aum_usd: null,
    source_document_id: doc.id,
    source_page: 1,
    source_quote: a.source_quote,
    confidence: a.confidence,
    preliminary: a.confidence < ALLOCATION_ACCEPT_CONFIDENCE,
    prompt_version: IPS_PROMPT_VERSION,
  }));

  let insertedCount = 0;
  if (toInsert.length > 0) {
    const { error, count } = await supabase
      .from("pension_allocations")
      .insert(toInsert, { count: "exact" });
    if (error) throw new Error(`ips_allocation_insert_failed: ${error.message}`);
    insertedCount = count ?? toInsert.length;
  }

  if (dropped.length > 0) {
    console.warn(
      `[classifier/ips] dropped ${dropped.length} allocations below confidence threshold ` +
        `(doc=${doc.id}): ${dropped.map((d) => `${d.asset_class}@${d.confidence.toFixed(2)}`).join(", ")}`,
    );
  }

  // Cross-source verification post-insert hook. See classifyCafr above
  // for the rationale. Same pattern: idempotent, fault-tolerant, non-blocking.
  if (insertedCount > 0) {
    try {
      const v = await verifyAllocationsForPlan(supabase, { planId: plan.id });
      if (v.pairsVerified > 0 || v.errors.length > 0) {
        console.log(
          `[classifier/ips] cross-source verification (doc=${doc.id}): ` +
            `considered=${v.pairsConsidered} new=${v.pairsVerified} ` +
            `already=${v.pairsAlreadyVerified} errors=${v.errors.length}`,
        );
      }
    } catch (e) {
      console.warn(
        `[classifier/ips] cross-source verification threw (doc=${doc.id}): ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  await supabase
    .from("documents")
    .update({
      processing_status: "complete",
      processed_at: new Date().toISOString(),
      api_tokens_used: tokensUsed,
      error_message: null,
    })
    .eq("id", doc.id);

  return {
    documentId: doc.id,
    ok: true,
    signalsExtracted: response.target_allocations.length,
    signalsInserted: insertedCount,
    signalsAccepted: accepted.length,
    signalsPreliminary: preliminary.length,
    signalsRejected: dropped.length,
    tokensUsed,
    confidences: response.target_allocations.map((a) => a.confidence),
  };
}

/**
 * Upload a PDF to Anthropic's Files API, run a classifier callback
 * against its file_id, and delete the file (best-effort, even on
 * classification failure) so we don't leak storage. Used whenever a
 * PDF exceeds the 24 MB inline-base64 threshold.
 */
async function classifyPdfViaFilesApi<T>(
  bytes: Uint8Array,
  documentId: string,
  run: (fileId: string) => Promise<T>,
): Promise<T> {
  const filename = `document-${documentId}.pdf`;
  const uploaded = await uploadPdfToFilesApi(bytes, filename);
  console.log(
    `[classifier/files-api] uploaded ${filename} size=${(uploaded.sizeBytes / 1024 / 1024).toFixed(2)}MB file_id=${uploaded.fileId} upload_ms=${uploaded.uploadMs}`,
  );
  try {
    const result = await run(uploaded.fileId);
    return result;
  } finally {
    try {
      const del = await deleteFileFromFilesApi(uploaded.fileId);
      console.log(
        `[classifier/files-api] deleted file_id=${uploaded.fileId} delete_ms=${del.deleteMs}`,
      );
    } catch (delErr) {
      console.warn(
        `[classifier/files-api] delete FAILED file_id=${uploaded.fileId}: ${delErr instanceof Error ? delErr.message : String(delErr)}`,
      );
    }
  }
}

/**
 * Return true for pdf-lib parse errors where unpdf (pdfjs) has a fair
 * chance of succeeding — i.e. the structural messages we see on
 * Minnesota SBI meeting books and Colorado PERA ACFRs. Genuine "file
 * is not a PDF" errors still get thrown so we don't silently retry on
 * bogus blobs.
 */
function isPdfLibParseRecoverable(err: Error): boolean {
  const msg = err.message;
  return (
    /PDFDict/i.test(msg) ||
    /Invalid object/i.test(msg) ||
    /Expected instance of/i.test(msg) ||
    /No PDF header found/i.test(msg) ||
    /xref/i.test(msg)
  );
}

async function markDocError(
  supabase: SupabaseClient,
  documentId: string,
  message: string,
): Promise<void> {
  await supabase
    .from("documents")
    .update({
      processing_status: "error",
      error_message: message,
      processed_at: new Date().toISOString(),
    })
    .eq("id", documentId);
}

function zeroOutcome(documentId: string, reason: string): ClassifyOutcome {
  return {
    documentId,
    ok: false,
    reason,
    signalsExtracted: 0,
    signalsInserted: 0,
    signalsAccepted: 0,
    signalsPreliminary: 0,
    signalsRejected: 0,
    tokensUsed: 0,
  };
}
