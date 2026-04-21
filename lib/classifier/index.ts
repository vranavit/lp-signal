import { PDFDocument } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractSignals } from "./extract";
import { computePriorityScore } from "./score";
import type { ClassifiedSignal } from "./schema";

const STORAGE_BUCKET = "documents";
const MAX_PAGES = 100;
const MIN_CONFIDENCE = 0.75;

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
      "id, plan_id, storage_path, meeting_date, processing_status, plan:plans!inner(id, name, tier)",
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

  const plan = doc.plan as unknown as {
    id: string;
    name: string;
    tier: number | null;
  };

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
