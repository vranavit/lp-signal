import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchWithDefaults } from "./http";

/**
 * CalPERS publishes its Investment Committee materials under the Board Meetings
 * index. URL structure (as of 2026-04):
 *
 *   Index page:      /about/board/board-meetings
 *   Per-meeting:     /about/board/board-meetings/invest-<YYYYMM>[-<n>]
 *   PDF downloads:   /documents/<slug>/download?inline  (content-type: application/pdf)
 *
 * The old /page/about/board/calpers-board/investment path returns 404.
 */
export const CALPERS_BOARD_MEETINGS_INDEX =
  "https://www.calpers.ca.gov/about/board/board-meetings";

const STORAGE_BUCKET = "documents";

type ScrapeResult = {
  pdfsFound: number;
  inserted: number;
  skipped: number;
  errors: { url: string; message: string }[];
};

export async function scrapeCalPERS(
  supabase: SupabaseClient,
  opts: { planId: string; maxPdfs?: number; maxMeetings?: number } = {
    planId: "",
  },
): Promise<ScrapeResult> {
  if (!opts.planId) throw new Error("scrapeCalPERS requires opts.planId");
  const result: ScrapeResult = {
    pdfsFound: 0,
    inserted: 0,
    skipped: 0,
    errors: [],
  };

  const pdfUrls = await discoverCalPERSPdfUrls({
    maxPdfs: opts.maxPdfs ?? 10,
    maxMeetings: opts.maxMeetings ?? 2,
  });
  result.pdfsFound = pdfUrls.length;

  for (const pdfUrl of pdfUrls) {
    try {
      const { hash, bytes, contentType } = await fetchAndHash(pdfUrl);
      if (!contentType.includes("pdf")) {
        result.errors.push({
          url: pdfUrl,
          message: `non-pdf content-type: ${contentType}`,
        });
        continue;
      }

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

      const storagePath = `calpers/${hash}.pdf`;
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
        source_url: pdfUrl,
        content_hash: hash,
        storage_path: storagePath,
        processing_status: "pending",
      });
      if (insertErr) throw insertErr;

      result.inserted += 1;
    } catch (err) {
      result.errors.push({
        url: pdfUrl,
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

/**
 * Two-level crawl:
 *   1. Board-meetings index → find Investment Committee meeting page URLs
 *      (anchors whose href contains '/board-meetings/invest-').
 *   2. For each meeting page, extract every document link. A "document link"
 *      is either a traditional `.pdf` href or a CalPERS-style
 *      `/documents/<slug>/download(?inline)` href.
 */
async function discoverCalPERSPdfUrls({
  maxPdfs,
  maxMeetings,
}: {
  maxPdfs: number;
  maxMeetings: number;
}): Promise<string[]> {
  const indexRes = await fetchWithDefaults(CALPERS_BOARD_MEETINGS_INDEX);
  if (!indexRes.ok) {
    throw new Error(
      `CalPERS index fetch failed: ${indexRes.status} ${indexRes.statusText}`,
    );
  }

  const $index = cheerio.load(await indexRes.text());
  const meetingUrls: string[] = [];
  const seenMeetings = new Set<string>();

  $index('a[href*="/board-meetings/invest-"]').each((_, el) => {
    const href = $index(el).attr("href");
    if (!href) return;
    const abs = new URL(href, CALPERS_BOARD_MEETINGS_INDEX).toString();
    if (!seenMeetings.has(abs)) {
      seenMeetings.add(abs);
      meetingUrls.push(abs);
    }
  });

  if (meetingUrls.length === 0) {
    throw new Error(
      "CalPERS scraper: no Investment Committee meeting links found on the " +
        "board-meetings index. The page structure may have changed.",
    );
  }

  const pdfs: string[] = [];
  const seenPdfs = new Set<string>();

  for (const meetingUrl of meetingUrls.slice(0, maxMeetings)) {
    try {
      const meetingRes = await fetchWithDefaults(meetingUrl);
      if (!meetingRes.ok) continue;

      const $m = cheerio.load(await meetingRes.text());
      $m("a").each((_, el) => {
        const href = $m(el).attr("href");
        if (!href) return;
        const abs = new URL(href, meetingUrl).toString();
        if (seenPdfs.has(abs)) return;

        const isCalpersDocLink =
          abs.includes("/documents/") && abs.includes("/download");
        const isPdfLink = abs.toLowerCase().includes(".pdf");

        if (isCalpersDocLink || isPdfLink) {
          seenPdfs.add(abs);
          pdfs.push(abs);
        }
      });

      if (pdfs.length >= maxPdfs) break;
    } catch {
      // one bad meeting page shouldn't kill the whole scrape — skip and continue
    }
  }

  return pdfs.slice(0, maxPdfs);
}

async function fetchAndHash(
  url: string,
): Promise<{ hash: string; bytes: Uint8Array; contentType: string }> {
  const res = await fetchWithDefaults(url);
  if (!res.ok) throw new Error(`PDF fetch failed: ${res.status} ${res.statusText}`);
  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  const buf = new Uint8Array(await res.arrayBuffer());
  const hash = createHash("sha256").update(buf).digest("hex");
  return { hash, bytes: buf, contentType };
}
