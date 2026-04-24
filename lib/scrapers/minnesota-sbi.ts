import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchWithDefaults } from "./http";

/**
 * Minnesota State Board of Investment (SBI).
 *
 *   Index page:  https://www.msbi.us/board-meetings
 *
 * SBI publishes three PDF kinds to /sites/default/files/YYYY-MM/*.pdf
 * per meeting:
 *
 *   - "SBI Board Meeting Materials - Month DD, YYYY.pdf"     (packet)
 *   - "SBI Board Meeting Minutes - Month DD, YYYY.pdf"       (minutes)
 *   - "MSBI Board Approvals - Month YYYY.pdf"                (summary)
 *
 * Naming conventions drift across years — historical filenames use
 * underscores and lowercase ("sbi_board_meeting_minutes_february_24_2022_0.pdf"),
 * later ones use URL-encoded spaces and commas, and the "Approvals" file
 * sometimes omits the day. We parse with tolerant regexes that handle
 * all observed variants; the YYYY-MM path segment provides a fallback
 * year anchor.
 *
 * Board meets quarterly (Feb / May / Aug / Dec typically). The mn.gov/sbi
 * vanity URL 302-redirects to www.msbi.us, so we scrape the canonical
 * host directly.
 */
export const MSBI_INDEX_URL = "https://www.msbi.us/board-meetings";
const MSBI_BASE = "https://www.msbi.us";
const STORAGE_BUCKET = "documents";

// Captures /sites/default/files/YYYY-MM/*.pdf hrefs under the MSBI site.
const MSBI_PDF_HREF_RE =
  /\/sites\/default\/files\/\d{4}-\d{2}\/[^"'\s]+\.pdf/gi;

export type MinnesotaSbiScrapeResult = {
  candidatesFound: number;
  pdfsFetched: number;
  inserted: number;
  skipped: number;
  errors: { url: string; message: string }[];
  totalBytes: number;
};

export type MinnesotaSbiCandidate = {
  url: string;
  meetingDate: string | null;
  // "materials" = board packet; "minutes" = board minutes; "approvals"
  // = quarterly approvals summary; "other" = asset-class reports,
  // affirmative-action plan, etc. (still ingested, classifier filters).
  kind: "materials" | "minutes" | "approvals" | "other";
};

export async function scrapeMinnesotaSbi(
  supabase: SupabaseClient,
  opts: { planId: string; maxPdfs?: number },
): Promise<MinnesotaSbiScrapeResult> {
  if (!opts.planId) throw new Error("scrapeMinnesotaSbi requires opts.planId");
  const maxPdfs = opts.maxPdfs ?? 25;

  const result: MinnesotaSbiScrapeResult = {
    candidatesFound: 0,
    pdfsFetched: 0,
    inserted: 0,
    skipped: 0,
    errors: [],
    totalBytes: 0,
  };

  const indexRes = await fetchWithDefaults(MSBI_INDEX_URL);
  if (!indexRes.ok) {
    throw new Error(
      `Minnesota SBI index fetch failed: ${indexRes.status} ${indexRes.statusText}`,
    );
  }
  const html = await indexRes.text();
  const candidates = discoverMinnesotaSbiCandidates(html).slice(0, maxPdfs);
  result.candidatesFound = candidates.length;

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

      const storagePath = `minnesota-sbi/${hash}.pdf`;
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
 * Parse Minnesota SBI /board-meetings HTML and return deduplicated,
 * newest-first candidates. Exposed for tests.
 */
export function discoverMinnesotaSbiCandidates(html: string): MinnesotaSbiCandidate[] {
  const $ = cheerio.load(html);
  const hrefs = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    if (MSBI_PDF_HREF_RE.test(href)) hrefs.add(href);
    MSBI_PDF_HREF_RE.lastIndex = 0;
  });
  for (const m of html.matchAll(MSBI_PDF_HREF_RE)) {
    hrefs.add(m[0]);
  }

  const candidates: MinnesotaSbiCandidate[] = [];
  for (const raw of hrefs) {
    const url = raw.startsWith("http") ? raw : `${MSBI_BASE}${raw}`;
    candidates.push({
      url,
      meetingDate: extractMinnesotaSbiMeetingDate(raw),
      kind: classifyMinnesotaSbiKind(raw),
    });
  }

  const byUrl = new Map<string, MinnesotaSbiCandidate>();
  for (const c of candidates) byUrl.set(c.url, c);
  return Array.from(byUrl.values()).sort((a, b) => {
    const da = a.meetingDate ?? "";
    const db = b.meetingDate ?? "";
    return db.localeCompare(da);
  });
}

const MONTH_FULL: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/**
 * Extract meeting date from a Minnesota SBI PDF href. Recognizes:
 *   - "Month DD, YYYY"  (URL-encoded: "Month%20DD%2C%20YYYY")
 *   - "Month DD YYYY"
 *   - "month_DD_YYYY"   (underscore-separated, lowercase)
 *   - "Month YYYY"      (no day — approvals summary)
 * Falls back to the YYYY-MM path segment when filename parsing fails.
 */
export function extractMinnesotaSbiMeetingDate(href: string): string | null {
  const decoded = decodeURIComponent(href);
  // Strip the path year-month so we match filename dates only; also keep
  // the path year-month as a fallback anchor.
  const pathYmMatch = decoded.match(/\/(\d{4})-(\d{2})\//);
  const pathYear = pathYmMatch ? parseInt(pathYmMatch[1], 10) : null;
  const pathMonth = pathYmMatch ? parseInt(pathYmMatch[2], 10) : null;

  // 1. "Month DD, YYYY" or "Month DD YYYY" (also handles underscores).
  const m1 = decoded.match(
    /(January|February|March|April|May|June|July|August|September|October|November|December)[\s_-]+(\d{1,2})[,\s_]+(\d{4})/i,
  );
  if (m1) {
    const month = MONTH_FULL[m1[1].toLowerCase()];
    const day = parseInt(m1[2], 10);
    const year = parseInt(m1[3], 10);
    if (validDate(year, month, day)) return iso(year, month, day);
  }

  // 2. "Month YYYY" (approvals summary — no day; anchor to first of month).
  const m2 = decoded.match(
    /(January|February|March|April|May|June|July|August|September|October|November|December)[\s_-]+(\d{4})/i,
  );
  if (m2) {
    const month = MONTH_FULL[m2[1].toLowerCase()];
    const year = parseInt(m2[2], 10);
    if (month && year >= 2000 && year <= 2100) return iso(year, month, 1);
  }

  // 3. Fallback to path year-month (MSBI uploads in the meeting month or
  //    shortly after — close enough to sort correctly).
  if (pathYear && pathMonth && pathMonth >= 1 && pathMonth <= 12) {
    return iso(pathYear, pathMonth, 1);
  }
  return null;
}

function classifyMinnesotaSbiKind(href: string): MinnesotaSbiCandidate["kind"] {
  const decoded = decodeURIComponent(href).toLowerCase();
  if (/minute/i.test(decoded)) return "minutes";
  if (/approval/i.test(decoded)) return "approvals";
  if (/material/i.test(decoded)) return "materials";
  return "other";
}

function validDate(y: number, m: number, d: number): boolean {
  return (
    y >= 2000 &&
    y <= 2100 &&
    m >= 1 &&
    m <= 12 &&
    d >= 1 &&
    d <= 31
  );
}

function iso(y: number, m: number, d: number): string {
  return `${y.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`;
}
