import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchWithDefaults, BotBlockedError } from "./http";

/**
 * Pennsylvania PSERS.
 *
 *   Newsroom post URL:   https://www.pa.gov/agencies/psers/newsroom/MMDDYYYY
 *   Resolution PDF dir:  https://www.pa.gov/content/dam/copapwp-pagov/en/psers/documents/board3/resolutions/{YYYY}/
 *
 * Each board meeting is published as a newsroom post at /newsroom/MMDDYYYY
 * containing prose + links to per-commitment resolution PDFs. Each resolution
 * PDF is a clean digital doc naming one GP fund + commitment amount + asset
 * class — gold for the classifier. We download each resolution as its own
 * document (one per signal) rather than the newsroom HTML.
 *
 * The newsroom index page is JS-rendered, so we cannot enumerate posts — we
 * generate candidate /newsroom/MMDDYYYY URLs for each weekday in the target
 * window and 404-tolerate misses. PSERS typically meets ~6x/year on a
 * Wed/Thu/Fri in the 3rd week of the month, so the hit rate on a sweep of
 * weeks 2–4 Wed/Thu/Fri is a few percent, which is fine given candidates are
 * cheap HTTP HEAD-equivalent GETs.
 */
export const PSERS_NEWSROOM_BASE = "https://www.pa.gov/agencies/psers/newsroom";
const STORAGE_BUCKET = "documents";

const RESOLUTION_HREF_RE =
  /\/content\/dam\/copapwp-pagov\/en\/psers\/documents\/board3\/resolutions\/\d{4}\/[^"'\s]+\.pdf/i;

export type PsersScrapeResult = {
  candidateDatesProbed: number;
  meetingPostsFound: number;
  resolutionPdfsFound: number;
  pdfsFetched: number;
  inserted: number;
  skipped: number;
  notFound: number;
  errors: { url: string; message: string }[];
  totalBytes: number;
};

export type PsersMeetingCandidate = {
  postUrl: string;
  meetingDate: string; // YYYY-MM-DD
};

export async function scrapePAPsers(
  supabase: SupabaseClient,
  opts: { planId: string; monthsBack?: number; now?: Date },
): Promise<PsersScrapeResult> {
  if (!opts.planId) throw new Error("scrapePAPsers requires opts.planId");
  const monthsBack = opts.monthsBack ?? 6;
  const candidates = generatePsersMeetingCandidates(monthsBack, opts.now);

  const result: PsersScrapeResult = {
    candidateDatesProbed: candidates.length,
    meetingPostsFound: 0,
    resolutionPdfsFound: 0,
    pdfsFetched: 0,
    inserted: 0,
    skipped: 0,
    notFound: 0,
    errors: [],
    totalBytes: 0,
  };

  for (const cand of candidates) {
    let html: string;
    try {
      const res = await fetchWithDefaults(cand.postUrl);
      if (res.status === 404) {
        result.notFound += 1;
        continue;
      }
      if (!res.ok) {
        result.errors.push({
          url: cand.postUrl,
          message: `HTTP ${res.status} ${res.statusText}`,
        });
        continue;
      }
      html = await res.text();
    } catch (err) {
      if (err instanceof BotBlockedError) throw err; // fatal — user must know
      result.errors.push({
        url: cand.postUrl,
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    // A valid meeting post mentions "Retirement Board" or "PSERB" and links to
    // at least one resolution PDF. A stray 200 on an unrelated URL will lack
    // resolution links and be dropped.
    const pdfUrls = extractResolutionPdfUrls(html);
    if (pdfUrls.length === 0) continue;
    result.meetingPostsFound += 1;
    result.resolutionPdfsFound += pdfUrls.length;

    for (const pdfUrl of pdfUrls) {
      try {
        const res = await fetchWithDefaults(pdfUrl);
        if (!res.ok) {
          result.errors.push({
            url: pdfUrl,
            message: `HTTP ${res.status} ${res.statusText}`,
          });
          continue;
        }
        const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
        if (!contentType.includes("pdf")) {
          result.errors.push({
            url: pdfUrl,
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

        const storagePath = `pa-psers/${hash}.pdf`;
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
          source_url: pdfUrl,
          content_hash: hash,
          storage_path: storagePath,
          processing_status: "pending",
          meeting_date: cand.meetingDate,
        });
        if (insErr) throw insErr;

        result.inserted += 1;
      } catch (err) {
        result.errors.push({
          url: pdfUrl,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  await supabase
    .from("plans")
    .update({ last_scraped_at: new Date().toISOString() })
    .eq("id", opts.planId);

  return result;
}

/**
 * Generate candidate /newsroom/MMDDYYYY URLs for PSERS board-meeting posts
 * over the last N months. PSERS board meetings typically land on a Wed/Thu/Fri
 * in weeks 2–4 of a month, so we sweep those weekdays. Each month contributes
 * ~9 candidates; most will 404 (expected). 6 months × 9 ≈ 54 URLs.
 */
export function generatePsersMeetingCandidates(
  monthsBack: number,
  now: Date = new Date(),
): PsersMeetingCandidate[] {
  const out: PsersMeetingCandidate[] = [];
  const year = now.getUTCFullYear();
  const monthIdx = now.getUTCMonth();

  for (let i = 0; i < monthsBack; i++) {
    const y = new Date(Date.UTC(year, monthIdx - i, 1)).getUTCFullYear();
    const m = new Date(Date.UTC(year, monthIdx - i, 1)).getUTCMonth();
    for (let day = 8; day <= 28; day++) {
      const d = new Date(Date.UTC(y, m, day));
      if (d > now) continue;
      const dow = d.getUTCDay(); // 0=Sun…6=Sat
      if (dow < 3 || dow > 5) continue; // Wed(3)/Thu(4)/Fri(5)
      const mm = String(m + 1).padStart(2, "0");
      const dd = String(day).padStart(2, "0");
      const meetingDate = `${y}-${mm}-${dd}`;
      const postUrl = `${PSERS_NEWSROOM_BASE}/${mm}${dd}${y}`;
      out.push({ postUrl, meetingDate });
    }
  }
  return out;
}

export function extractResolutionPdfUrls(html: string): string[] {
  const $ = cheerio.load(html);
  const set = new Set<string>();
  $("a").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    if (!RESOLUTION_HREF_RE.test(href)) return;
    const abs = href.startsWith("http")
      ? href
      : new URL(href, "https://www.pa.gov").toString();
    set.add(abs);
  });
  return Array.from(set);
}
