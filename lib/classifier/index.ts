import { PDFDocument } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractSignals } from "./extract";
import { computePriorityScore } from "./score";
import type { ClassifiedSignal } from "./schema";

const STORAGE_BUCKET = "documents";
const MAX_PAGES = 100;
const MIN_CONFIDENCE = 0.75;

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
      tokensUsed: 0,
    };
  }

  // Out-of-scope URL filter (transcripts, etc.). Mark as error with a clear
  // reason so we can revisit in Phase 3 without re-running the classifier.
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
      tokensUsed: 0,
    };
  }

  // Document-type branch. GP press releases go through a different flow
  // (plain-text extraction + specialized prompt). Stubbed until the prompt
  // is finalized with the operator — intentionally errors out so no GP
  // press-release doc gets classified with the wrong prompt by accident.
  if (doc.document_type === "gp_press_release") {
    await supabase
      .from("documents")
      .update({
        processing_status: "error",
        error_message:
          "not_implemented: gp_press_release prompt pending approval",
        processed_at: new Date().toISOString(),
      })
      .eq("id", documentId);
    return {
      documentId,
      ok: false,
      reason: "gp_press_release_not_implemented",
      signalsExtracted: 0,
      signalsInserted: 0,
      tokensUsed: 0,
    };
  }

  const plan = doc.plan as unknown as {
    id: string;
    name: string;
    tier: number | null;
  } | null;

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
      tokensUsed: 0,
    };
  }

  await supabase
    .from("documents")
    .update({ processing_status: "processing" })
    .eq("id", documentId);

  try {
    if (!doc.storage_path) throw new Error("document has no storage_path");

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
        `pdf_parse_failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (pageCount > MAX_PAGES) {
      await supabase
        .from("documents")
        .update({
          processing_status: "error",
          error_message: `too_long: ${pageCount} pages (max ${MAX_PAGES})`,
          processed_at: new Date().toISOString(),
        })
        .eq("id", documentId);
      return {
        documentId,
        ok: false,
        reason: "too_long",
        signalsExtracted: 0,
        signalsInserted: 0,
        tokensUsed: 0,
        pages: pageCount,
      };
    }

    const pdfBase64 = Buffer.from(bytes).toString("base64");

    const { response, tokensUsed } = await extractSignals({
      pdfBase64,
      planName: plan.name,
      meetingDate: doc.meeting_date,
    });

    const accepted = response.signals.filter(
      (s) => s.confidence >= MIN_CONFIDENCE,
    );

    const rows = accepted.map((s) => buildSignalRow(s, doc, plan));

    let insertedCount = 0;
    if (rows.length > 0) {
      const { error: insErr, count } = await supabase
        .from("signals")
        .insert(rows, { count: "exact" });
      if (insErr) throw new Error(`signal_insert_failed: ${insErr.message}`);
      insertedCount = count ?? rows.length;
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
      tokensUsed: 0,
    };
  }
}

function buildSignalRow(
  s: ClassifiedSignal,
  doc: { id: string; plan_id: string; meeting_date: string | null },
  plan: { tier: number | null },
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
    plan_tier: plan.tier,
    meeting_date: doc.meeting_date,
  });

  return {
    document_id: doc.id,
    plan_id: doc.plan_id,
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
  };
}
