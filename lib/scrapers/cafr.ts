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

/**
 * Size above which Supabase Storage rejects the upload (project
 * file_size_limit, currently 50 MB on this project). CAFRs larger
 * than this bypass storage entirely and are classified inline via
 * `ingestOversizedCafrFromBytes` — they live in Anthropic's Files
 * API only for the duration of the classifier call.
 */
export const SUPABASE_STORAGE_CAP_BYTES = 50 * 1024 * 1024;

/**
 * Download a PDF from a URL. Exposed so callers building an oversized-
 * CAFR pipeline can fetch bytes directly without going through
 * `ingestCafr`'s storage upload.
 */
export async function downloadPdfBytes(
  url: string,
): Promise<{ bytes: Uint8Array; hash: string; contentType: string }> {
  const res = await fetchWithDefaults(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
  }
  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("pdf")) {
    throw new Error(`non-pdf content-type: ${contentType}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const hash = createHash("sha256").update(bytes).digest("hex");
  return { bytes, hash, contentType };
}

/**
 * Insert a CAFR documents row without writing to Supabase Storage.
 * Used for PDFs above SUPABASE_STORAGE_CAP_BYTES — the bytes get
 * classified inline via the Files API and are not persisted locally.
 * `storage_path` is set to a sentinel so the classifier's storage-
 * download step would fail obviously if anything re-triggers it
 * (only `classifyCafrFromBytes` should be reached from this path).
 */
export async function insertOversizedCafrRow(
  supabase: SupabaseClient,
  args: {
    planId: string;
    url: string;
    fiscalYearEnd: string;
    hash: string;
  },
): Promise<{ documentId: string; alreadyExisted: boolean }> {
  const { data: existing } = await supabase
    .from("documents")
    .select("id")
    .eq("plan_id", args.planId)
    .eq("content_hash", args.hash)
    .maybeSingle();
  if (existing) {
    return { documentId: existing.id, alreadyExisted: true };
  }
  const { data: inserted, error } = await supabase
    .from("documents")
    .insert({
      plan_id: args.planId,
      document_type: "cafr",
      source_url: args.url,
      content_hash: args.hash,
      // Null storage_path signals "oversized — classify via Files API
      // inline only; never re-download". The classifier's standard
      // CAFR path asserts storage_path is non-null precisely to avoid
      // silently returning zero on a re-run.
      storage_path: null,
      processing_status: "pending",
      meeting_date: args.fiscalYearEnd,
    })
    .select("id")
    .single();
  if (error || !inserted) {
    throw new Error(`oversized_cafr_insert_failed: ${error?.message ?? "no row"}`);
  }
  return { documentId: inserted.id, alreadyExisted: false };
}

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
