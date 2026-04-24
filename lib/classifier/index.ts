import { PDFDocument } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CLASSIFIER_MODEL,
  extractSignalsFromPdf,
  extractSignalsFromText,
  extractSignalsFromAgendaExcerpt,
  extractAllocationsFromCafrPdf,
  type ExtractResult,
} from "./extract";
import {
  extractCommitmentPages,
  extractPdfTextFallback,
} from "./extract-commitment-pages";
import { PROMPT_VERSION } from "./prompt";
import { GP_PROMPT_VERSION } from "./prompts/gp-press-release";
import { CAFR_PROMPT_VERSION } from "./prompts/cafr-allocation";
import { computePriorityScore } from "./score";
import type { ClassifiedSignal } from "./schema";
import type { CafrAllocation } from "./schemas/cafr-allocation";

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

  const isPressRelease = doc.document_type === "gp_press_release";
  const isCafr = doc.document_type === "cafr";

  // Pre-flight validation (before marking status = processing). Per-route:
  //   pension PDF: requires plan + not a transcript URL.
  //   press release: requires gp + content_text.
  if (!isPressRelease) {
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
  } else if (!gp || !doc.content_text) {
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

  await supabase
    .from("documents")
    .update({ processing_status: "processing" })
    .eq("id", documentId);

  try {
    // CAFR path diverges early — it writes to pension_allocations, not signals.
    if (isCafr) {
      return await classifyCafr(supabase, doc, plan as { id: string; name: string; tier: number | null });
    }

    let extract: ExtractResult;
    let pageCount: number | undefined;

    if (isPressRelease) {
      extract = await extractSignalsFromText({
        text: doc.content_text as string,
        gpName: (gp as { id: string; name: string }).name,
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

        const pdfBase64 = Buffer.from(bytes).toString("base64");

        extract = await extractSignalsFromPdf({
          pdfBase64,
          planName: (plan as { name: string }).name,
          meetingDate: doc.meeting_date,
        });
        pageCount = parsedPageCount;
      }
    }

    const { response, tokensUsed } = extract;

    // Origin bundles the provenance each row needs to be written correctly.
    // Exactly one of { plan, gp } is non-null per document.
    const origin = {
      plan_id: isPressRelease ? null : (plan as { id: string }).id,
      gp_id: isPressRelease ? (gp as { id: string }).id : null,
      plan_tier: isPressRelease ? null : (plan as { tier: number | null }).tier,
      prompt_version: isPressRelease ? GP_PROMPT_VERSION : PROMPT_VERSION,
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

    let insertedCount = 0;
    if (signalRows.length > 0) {
      const { error: insErr, count } = await supabase
        .from("signals")
        .insert(signalRows, { count: "exact" });
      if (insErr) throw new Error(`signal_insert_failed: ${insErr.message}`);
      insertedCount = count ?? signalRows.length;
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

  let pageCount = 0;
  try {
    const pdf = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      throwOnInvalidObject: false,
    });
    pageCount = pdf.getPageCount();
  } catch (err) {
    throw new Error(
      `cafr_pdf_parse_failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (pageCount > CAFR_MAX_PAGES) {
    await markDocError(
      supabase,
      doc.id,
      `too_long: ${pageCount} pages (max ${CAFR_MAX_PAGES})`,
    );
    return { ...zeroOutcome(doc.id, "too_long"), pages: pageCount };
  }

  const pdfBase64 = Buffer.from(bytes).toString("base64");
  const extract = await extractAllocationsFromCafrPdf({
    pdfBase64,
    planName: plan.name,
    fiscalYearEnd: doc.meeting_date,
  });
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

  const toInsert = [...accepted, ...preliminary].map((a) => ({
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
