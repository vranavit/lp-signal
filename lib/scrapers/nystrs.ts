import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchWithDefaults } from "./http";

/**
 * NYSTRS — New York State Teachers' Retirement System.
 *
 * Primary disclosure: a single stable-URL rolling PDF
 *   https://www.nystrs.org/getmedia/9faf83c9-e0da-4e86-b436-c0ce2bc272ee/PE_Commitments.pdf
 * updated each quarter with that quarter's Private Equity commitments. Every
 * entry is a self-contained paragraph: fund name, approval date, commitment
 * amount, strategy — exactly what the classifier needs.
 *
 * The Board Meetings index is 403-bot-blocked even with our browser-like
 * headers; per research that source needs a headless browser (hard-stop for
 * this sprint). We stick with PE_Commitments.pdf as the canonical source.
 * Content-hash dedup handles quarterly updates: new quarter → new hash →
 * reprocess; unchanged → skip.
 */
export const NYSTRS_PE_COMMITMENTS_URL =
  "https://www.nystrs.org/getmedia/9faf83c9-e0da-4e86-b436-c0ce2bc272ee/PE_Commitments.pdf";
const STORAGE_BUCKET = "documents";

export type NystrsScrapeResult = {
  pdfsFetched: number;
  inserted: number;
  skipped: number;
  errors: { url: string; message: string }[];
  totalBytes: number;
};

export async function scrapeNYSTRS(
  supabase: SupabaseClient,
  opts: { planId: string },
): Promise<NystrsScrapeResult> {
  if (!opts.planId) throw new Error("scrapeNYSTRS requires opts.planId");

  const result: NystrsScrapeResult = {
    pdfsFetched: 0,
    inserted: 0,
    skipped: 0,
    errors: [],
    totalBytes: 0,
  };

  try {
    const res = await fetchWithDefaults(NYSTRS_PE_COMMITMENTS_URL);
    if (!res.ok) {
      result.errors.push({
        url: NYSTRS_PE_COMMITMENTS_URL,
        message: `HTTP ${res.status} ${res.statusText}`,
      });
      return result;
    }
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.includes("pdf")) {
      result.errors.push({
        url: NYSTRS_PE_COMMITMENTS_URL,
        message: `non-pdf content-type: ${contentType}`,
      });
      return result;
    }

    const bytes = new Uint8Array(await res.arrayBuffer());
    const hash = createHash("sha256").update(bytes).digest("hex");
    result.pdfsFetched = 1;
    result.totalBytes = bytes.length;

    const { data: existing } = await supabase
      .from("documents")
      .select("id")
      .eq("plan_id", opts.planId)
      .eq("content_hash", hash)
      .maybeSingle();
    if (existing) {
      result.skipped = 1;
    } else {
      const storagePath = `nystrs/${hash}.pdf`;
      const { error: upErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, bytes, {
          contentType: "application/pdf",
          upsert: true,
        });
      if (upErr) throw upErr;

      const { error: insErr } = await supabase.from("documents").insert({
        plan_id: opts.planId,
        document_type: "board_minutes",
        source_url: NYSTRS_PE_COMMITMENTS_URL,
        content_hash: hash,
        storage_path: storagePath,
        processing_status: "pending",
        meeting_date: null,
      });
      if (insErr) throw insErr;

      result.inserted = 1;
    }
  } catch (err) {
    result.errors.push({
      url: NYSTRS_PE_COMMITMENTS_URL,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  await supabase
    .from("plans")
    .update({ last_scraped_at: new Date().toISOString() })
    .eq("id", opts.planId);

  return result;
}
