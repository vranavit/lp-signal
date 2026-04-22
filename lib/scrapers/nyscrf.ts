import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchWithDefaults } from "./http";

/**
 * NYSCRF (New York State Common Retirement Fund) publishes Monthly Transaction
 * Reports as digital PDFs on the Office of the State Comptroller site.
 *
 *   Archive page:  /common-retirement-fund/resources/financial-reporting-and-asset-allocation
 *   PDF pattern:   /files/common-retirement-fund/pdf/{month-lowercase}-{yyyy}.pdf
 *
 * Publication lag is ~6–8 weeks — the most recent month is usually not yet
 * published. We generate the candidate URLs by pattern (no index scrape) and
 * tolerate 404s for months that aren't up yet.
 *
 * Reports can be retroactively amended (footnotes flag this). Dedup via
 * content_hash handles re-runs; explicit amendment-aware re-fetch is out of
 * scope for the one-shot backfill.
 */
export const NYSCRF_ARCHIVE_URL =
  "https://www.osc.ny.gov/common-retirement-fund/resources/financial-reporting-and-asset-allocation";

const PDF_URL_BASE = "https://www.osc.ny.gov/files/common-retirement-fund/pdf";
const STORAGE_BUCKET = "documents";

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

export type NyscrfScrapeResult = {
  monthsAttempted: number;
  pdfsFetched: number;
  inserted: number;
  skipped: number;
  notYetPublished: { label: string; url: string }[];
  errors: { url: string; message: string }[];
  totalBytes: number;
};

export type NyscrfMonth = {
  label: string;
  url: string;
  meetingDate: string;
};

/**
 * Generate the last N months of candidate report URLs, newest first. Today's
 * month is included; the scraper will 404-skip it if not yet published.
 */
export function nyscrfMonthCandidates(
  monthsBack: number,
  now: Date = new Date(),
): NyscrfMonth[] {
  const out: NyscrfMonth[] = [];
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-indexed

  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(Date.UTC(year, month - i, 1));
    const y = d.getUTCFullYear();
    const mIdx = d.getUTCMonth();
    const mName = MONTH_NAMES[mIdx];
    const label = `${mName}-${y}`;
    out.push({
      label,
      url: `${PDF_URL_BASE}/${label}.pdf`,
      meetingDate: `${y}-${String(mIdx + 1).padStart(2, "0")}-01`,
    });
  }
  return out;
}

export async function scrapeNYSCRF(
  supabase: SupabaseClient,
  opts: { planId: string; monthsBack?: number; now?: Date },
): Promise<NyscrfScrapeResult> {
  if (!opts.planId) throw new Error("scrapeNYSCRF requires opts.planId");
  const monthsBack = opts.monthsBack ?? 6;
  const candidates = nyscrfMonthCandidates(monthsBack, opts.now);

  const result: NyscrfScrapeResult = {
    monthsAttempted: candidates.length,
    pdfsFetched: 0,
    inserted: 0,
    skipped: 0,
    notYetPublished: [],
    errors: [],
    totalBytes: 0,
  };

  for (const cand of candidates) {
    try {
      const res = await fetchWithDefaults(cand.url);

      if (res.status === 404) {
        result.notYetPublished.push({ label: cand.label, url: cand.url });
        continue;
      }
      if (!res.ok) {
        result.errors.push({
          url: cand.url,
          message: `HTTP ${res.status} ${res.statusText}`,
        });
        continue;
      }

      const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
      if (!contentType.includes("pdf")) {
        result.errors.push({
          url: cand.url,
          message: `non-pdf content-type: ${contentType}`,
        });
        continue;
      }

      const bytes = new Uint8Array(await res.arrayBuffer());
      const hash = createHash("sha256").update(bytes).digest("hex");
      result.pdfsFetched += 1;
      result.totalBytes += bytes.length;

      const { data: existing } = await supabase
        .from("documents")
        .select("id")
        .eq("plan_id", opts.planId)
        .eq("content_hash", hash)
        .maybeSingle();

      if (existing) {
        result.skipped += 1;
        continue;
      }

      const storagePath = `nyscrf/${hash}.pdf`;
      const { error: uploadErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, bytes, {
          contentType: "application/pdf",
          upsert: true,
        });
      if (uploadErr) throw uploadErr;

      const { error: insertErr } = await supabase.from("documents").insert({
        plan_id: opts.planId,
        document_type: "board_minutes",
        source_url: cand.url,
        content_hash: hash,
        storage_path: storagePath,
        processing_status: "pending",
        meeting_date: cand.meetingDate,
      });
      if (insertErr) throw insertErr;

      result.inserted += 1;
    } catch (err) {
      result.errors.push({
        url: cand.url,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await supabase
    .from("plans")
    .update({ last_scraped_at: new Date().toISOString() })
    .eq("id", opts.planId);

  return result;
}
