import { PDFDocument } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CLASSIFIER_MODEL,
  extractSignalsFromPdf,
  extractSignalsFromText,
  type ExtractResult,
} from "./extract";
import { PROMPT_VERSION } from "./prompt";
import { GP_PROMPT_VERSION } from "./prompts/gp-press-release";
import { computePriorityScore } from "./score";
import type { ClassifiedSignal } from "./schema";

const STORAGE_BUCKET = "documents";
const MAX_PAGES = 100;

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

      let parsedPageCount = 0;
      try {
        const pdf = await PDFDocument.load(bytes, {
          ignoreEncryption: true,
          throwOnInvalidObject: false,
        });
        parsedPageCount = pdf.getPageCount();
      } catch (err) {
        throw new Error(
          `pdf_parse_failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

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
