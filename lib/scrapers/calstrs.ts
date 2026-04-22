import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchWithDefaults } from "./http";

/**
 * CalSTRS — California State Teachers' Retirement System.
 *
 *   Index page:     https://www.calstrs.com/board-meetings  (current year)
 *                   https://www.calstrs.com/board-meetings?year=YYYY  (older)
 *   Meeting URL:    /{YYYY-MM-DD}-board-meeting-{month}-{year}
 *   PDF URL:        /files/{hash}/{prefix}+{YYYY-MM}+Item+...pdf
 *     prefix ∈ {INV, TRB, ARM, COMP} — INV = Investment Committee (our target)
 *
 * The PDF slug contains a random hash segment so URLs can't be generated —
 * must scrape meeting pages for anchor hrefs. We filter to INV+* PDFs only;
 * other prefixes are non-investment committees (Benefits, Audit, etc).
 *
 * calstrs.com is CDN-anti-bot and 403s plain fetch(); the shared HTTP util
 * with full Chrome-like headers clears it.
 */
export const CALSTRS_INDEX_CURRENT_URL =
  "https://www.calstrs.com/board-meetings";
const CALSTRS_ORIGIN = "https://www.calstrs.com";
const STORAGE_BUCKET = "documents";

const MEETING_HREF_RE = /^\/(\d{4})-(\d{2})-(\d{2})-board-meeting-[a-z]+-\d{4}\/?$/i;
const INV_PDF_HREF_RE = /^\/files\/[a-z0-9]+\/INV[+]/i;

export type CalstrsScrapeResult = {
  meetingsConsidered: number;
  pdfsFound: number;
  inserted: number;
  skipped: number;
  errors: { url: string; message: string }[];
  totalBytes: number;
};

export type CalstrsMeeting = {
  url: string;
  meetingDate: string;
};

export async function scrapeCalSTRS(
  supabase: SupabaseClient,
  opts: { planId: string; monthsBack?: number; maxPdfs?: number; now?: Date },
): Promise<CalstrsScrapeResult> {
  if (!opts.planId) throw new Error("scrapeCalSTRS requires opts.planId");
  const monthsBack = opts.monthsBack ?? 6;
  const maxPdfs = opts.maxPdfs ?? 60;

  const result: CalstrsScrapeResult = {
    meetingsConsidered: 0,
    pdfsFound: 0,
    inserted: 0,
    skipped: 0,
    errors: [],
    totalBytes: 0,
  };

  const meetings = await discoverCalstrsMeetings(monthsBack, opts.now);
  result.meetingsConsidered = meetings.length;

  for (const m of meetings) {
    if (result.pdfsFound >= maxPdfs) break;
    let pdfUrls: string[];
    try {
      const meetingRes = await fetchWithDefaults(m.url);
      if (!meetingRes.ok) {
        result.errors.push({
          url: m.url,
          message: `meeting page HTTP ${meetingRes.status}`,
        });
        continue;
      }
      const html = await meetingRes.text();
      pdfUrls = extractCalstrsInvPdfUrls(html);
    } catch (err) {
      result.errors.push({
        url: m.url,
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    for (const pdfUrl of pdfUrls) {
      if (result.pdfsFound >= maxPdfs) break;
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
        result.pdfsFound += 1;
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

        const storagePath = `calstrs/${hash}.pdf`;
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
          meeting_date: m.meetingDate,
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
 * Crawl the current-year and prior-year index pages to collect meeting
 * sub-page URLs within the cutoff window. Current year only is often enough
 * for 6 months back; prior year is fetched so the 6-month window can straddle
 * a new-year boundary.
 */
async function discoverCalstrsMeetings(
  monthsBack: number,
  now: Date = new Date(),
): Promise<CalstrsMeeting[]> {
  const cutoffMs = now.getTime() - monthsBack * 31 * 86_400_000;
  const currentYear = now.getUTCFullYear();
  const priorYear = currentYear - 1;

  const indexUrls = [
    CALSTRS_INDEX_CURRENT_URL,
    `${CALSTRS_INDEX_CURRENT_URL}?year=${priorYear}`,
  ];

  const byUrl = new Map<string, CalstrsMeeting>();
  for (const indexUrl of indexUrls) {
    try {
      const res = await fetchWithDefaults(indexUrl);
      if (!res.ok) continue;
      const html = await res.text();
      const meetings = extractCalstrsMeetingHrefs(html);
      for (const m of meetings) {
        const tsMs = Date.parse(`${m.meetingDate}T00:00:00Z`);
        if (!Number.isFinite(tsMs) || tsMs < cutoffMs) continue;
        if (!byUrl.has(m.url)) byUrl.set(m.url, m);
      }
    } catch {
      // index fetch failure isn't fatal — move on with whatever we got
    }
  }
  return Array.from(byUrl.values()).sort((a, b) =>
    b.meetingDate.localeCompare(a.meetingDate),
  );
}

export function extractCalstrsMeetingHrefs(html: string): CalstrsMeeting[] {
  const $ = cheerio.load(html);
  const out: CalstrsMeeting[] = [];
  const seen = new Set<string>();
  $("a").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const m = href.match(MEETING_HREF_RE);
    if (!m) return;
    const [, yyyy, mm, dd] = m;
    const abs = new URL(href, CALSTRS_ORIGIN).toString();
    if (seen.has(abs)) return;
    seen.add(abs);
    out.push({ url: abs, meetingDate: `${yyyy}-${mm}-${dd}` });
  });
  return out;
}

export function extractCalstrsInvPdfUrls(html: string): string[] {
  const $ = cheerio.load(html);
  const set = new Set<string>();
  $("a").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    if (!INV_PDF_HREF_RE.test(href)) return;
    const abs = new URL(href, CALSTRS_ORIGIN).toString();
    set.add(abs);
  });
  return Array.from(set);
}
