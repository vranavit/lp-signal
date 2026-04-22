import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchWithDefaults } from "./http";

/**
 * Generic CAFR (Comprehensive Annual Financial Report / Annual Comprehensive
 * Financial Report) ingestor. CAFRs are published once a year by each plan
 * and are the authoritative source for portfolio allocation stock data
 * (target % / actual % / policy range per asset class). We store them with
 * `document_type = 'cafr'` so the classifier branches to the allocation
 * extraction prompt.
 *
 * Discovery is per-plan (URL patterns differ) — this file only handles the
 * download+store step. Each runner hardcodes the direct PDF URL + fiscal
 * year end. If next year's URL moves, the runner gets updated.
 *
 * CAFRs are large (5–20 MB, 150–300 pages). We accept whatever the server
 * returns; the classifier is what enforces the per-doc page cap.
 */
const STORAGE_BUCKET = "documents";

export type CafrIngestArgs = {
  planId: string;
  planKey: string; // used for storage subfolder, e.g. "calpers"
  url: string;
  fiscalYearEnd: string; // YYYY-MM-DD
};

export type CafrIngestResult = {
  url: string;
  fetched: boolean;
  inserted: boolean;
  skipped: boolean;
  bytes: number;
  error?: string;
  documentId?: string;
};

export async function ingestCafr(
  supabase: SupabaseClient,
  args: CafrIngestArgs,
): Promise<CafrIngestResult> {
  const result: CafrIngestResult = {
    url: args.url,
    fetched: false,
    inserted: false,
    skipped: false,
    bytes: 0,
  };

  try {
    const res = await fetchWithDefaults(args.url);
    if (!res.ok) {
      result.error = `HTTP ${res.status} ${res.statusText}`;
      return result;
    }
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!ct.includes("pdf")) {
      result.error = `non-pdf content-type: ${ct}`;
      return result;
    }

    const bytes = new Uint8Array(await res.arrayBuffer());
    const hash = createHash("sha256").update(bytes).digest("hex");
    result.fetched = true;
    result.bytes = bytes.length;

    const { data: existing } = await supabase
      .from("documents")
      .select("id")
      .eq("plan_id", args.planId)
      .eq("content_hash", hash)
      .maybeSingle();
    if (existing) {
      result.skipped = true;
      result.documentId = existing.id;
      return result;
    }

    const storagePath = `${args.planKey}/cafr/${hash}.pdf`;
    const { error: upErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, bytes, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (upErr) throw upErr;

    const { data: inserted, error: insErr } = await supabase
      .from("documents")
      .insert({
        plan_id: args.planId,
        document_type: "cafr",
        source_url: args.url,
        content_hash: hash,
        storage_path: storagePath,
        processing_status: "pending",
        meeting_date: args.fiscalYearEnd,
      })
      .select("id")
      .single();
    if (insErr) throw insErr;

    result.inserted = true;
    result.documentId = inserted?.id;
    return result;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  }
}
