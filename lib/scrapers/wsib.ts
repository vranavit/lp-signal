import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchWithDefaults } from "./http";

/**
 * Washington State Investment Board.
 *
 *   Index page:  https://www.sib.wa.gov/meetings.html
 *   PDF path:    /docs/meetings/{committee}/{YY}_{MMDD}{final|content}.pdf
 *     committee ∈ {board, admin, private, public, audit}
 *     state: "final" = approved minutes, "content" = preliminary/upcoming
 *
 * We only scrape Private Markets Committee meetings for LP-commitment signals.
 * Board minutes often re-ratify PMC recommendations — scraping both would
 * double-count, so we stick with PMC as the commitment-dense source.
 */
export const WSIB_INDEX_URL = "https://www.sib.wa.gov/meetings.html";
const STORAGE_BUCKET = "documents";

const PMC_HREF_RE =
  /\/docs\/meetings\/private\/(\d{2})_(\d{2})(\d{2})(final|content)\.pdf$/i;

export type WsibScrapeResult = {
  pmcMeetingsFound: number;
  candidatesConsidered: number;
  pdfsFetched: number;
  inserted: number;
  skipped: number;
  errors: { url: string; message: string }[];
  totalBytes: number;
};

export type WsibPmcCandidate = {
  url: string;
  meetingDate: string;
  state: "final" | "content";
};

export async function scrapeWSIB(
  supabase: SupabaseClient,
  opts: { planId: string; monthsBack?: number },
): Promise<WsibScrapeResult> {
  if (!opts.planId) throw new Error("scrapeWSIB requires opts.planId");
  const monthsBack = opts.monthsBack ?? 6;

  const result: WsibScrapeResult = {
    pmcMeetingsFound: 0,
    candidatesConsidered: 0,
    pdfsFetched: 0,
    inserted: 0,
    skipped: 0,
    errors: [],
    totalBytes: 0,
  };

  const indexRes = await fetchWithDefaults(WSIB_INDEX_URL);
  if (!indexRes.ok) {
    throw new Error(
      `WSIB index fetch failed: ${indexRes.status} ${indexRes.statusText}`,
    );
  }
  const html = await indexRes.text();
  const candidates = discoverPmcCandidates(html, monthsBack);
  result.pmcMeetingsFound = candidates.length;
  result.candidatesConsidered = candidates.length;

  for (const cand of candidates) {
    try {
      const res = await fetchWithDefaults(cand.url);
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

      const storagePath = `wsib/${hash}.pdf`;
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
        source_url: cand.url,
        content_hash: hash,
        storage_path: storagePath,
        processing_status: "pending",
        meeting_date: cand.meetingDate,
      });
      if (insErr) throw insErr;

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

/**
 * Parse the meetings.html page and return PMC PDF candidates within the last
 * `monthsBack` months. If both `final` and `content` exist for the same date,
 * prefer `final` (approved minutes) and drop the `content` (preliminary).
 */
export function discoverPmcCandidates(
  html: string,
  monthsBack: number,
  now: Date = new Date(),
): WsibPmcCandidate[] {
  const $ = cheerio.load(html);
  const cutoffMs = now.getTime() - monthsBack * 30 * 86_400_000;
  const byDate = new Map<string, WsibPmcCandidate>();

  $("a").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const m = href.match(PMC_HREF_RE);
    if (!m) return;
    const [, yy, mm, dd, state] = m;
    const year = 2000 + Number(yy);
    const meetingDate = `${year}-${mm}-${dd}`;
    const tsMs = Date.parse(`${meetingDate}T00:00:00Z`);
    if (!Number.isFinite(tsMs) || tsMs < cutoffMs) return;

    const abs = new URL(href, WSIB_INDEX_URL).toString();
    const cand: WsibPmcCandidate = {
      url: abs,
      meetingDate,
      state: state.toLowerCase() as "final" | "content",
    };
    const prev = byDate.get(meetingDate);
    if (!prev || (prev.state === "content" && cand.state === "final")) {
      byDate.set(meetingDate, cand);
    }
  });

  return Array.from(byDate.values()).sort((a, b) =>
    b.meetingDate.localeCompare(a.meetingDate),
  );
}
