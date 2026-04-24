import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchWithDefaults } from "./http";

/**
 * New Jersey Division of Investment — State Investment Council.
 *
 *   Index page:  https://www.nj.gov/treasury/doinvest/approvedminutes.shtml
 *
 * The SIC approves/ratifies commitment decisions for the NJ Pension Fund
 * (~$100B AUM across state employee / teacher / police / fire systems)
 * and publishes approved minutes to
 * /treasury/doinvest/pdf/ApprovedMinutes/YYYY/*.pdf with several
 * generations of filename conventions:
 *
 *   2025+ :  RegularMinutesOctober202025.pdf
 *            AnnualMinutesJanuary292025.pdf
 *            SpecialMinutesMarch182025.pdf
 *   2023+ :  minutesoctober2023.pdf
 *            Minutes10302024.pdf                 (MMDDYYYY)
 *   2010+ :  ApprovedMinutes0110.pdf              (MMYY)
 *            ApprovedMinutes070610.pdf            (MMDDYY)
 *   2008-  :  Feb21-2008.pdf / approved_minutes_mar_08.pdf / Jan17-2008.pdf
 *
 * The /YYYY/ path segment anchors the year in every case, so even when
 * filename parsing fails we fall back to the path year. The index page
 * also references per-year Agenda folders but those are announcement-only
 * and not mirrored after the meeting, so we stick to the Minutes folder.
 */
export const NJ_DOI_INDEX_URL =
  "https://www.nj.gov/treasury/doinvest/approvedminutes.shtml";
const NJ_DOI_BASE = "https://www.nj.gov";
const STORAGE_BUCKET = "documents";

// Captures minutes PDFs under /treasury/doinvest/pdf/ApprovedMinutes/YYYY/.
// Hrefs on the index mix site-relative (`/treasury/...`) and page-relative
// (`pdf/ApprovedMinutes/...`) — normalize both.
const NJ_DOI_PDF_HREF_RE =
  /(?:\/treasury\/doinvest\/)?pdf\/ApprovedMinutes\/\d{4}\/[^"'\s]+\.pdf/gi;

export type NjDoiScrapeResult = {
  candidatesFound: number;
  pdfsFetched: number;
  inserted: number;
  skipped: number;
  errors: { url: string; message: string }[];
  totalBytes: number;
};

export type NjDoiPdfCandidate = {
  url: string;
  meetingDate: string | null;
};

export async function scrapeNjDoi(
  supabase: SupabaseClient,
  opts: { planId: string; maxPdfs?: number },
): Promise<NjDoiScrapeResult> {
  if (!opts.planId) throw new Error("scrapeNjDoi requires opts.planId");
  const maxPdfs = opts.maxPdfs ?? 25;

  const result: NjDoiScrapeResult = {
    candidatesFound: 0,
    pdfsFetched: 0,
    inserted: 0,
    skipped: 0,
    errors: [],
    totalBytes: 0,
  };

  const indexRes = await fetchWithDefaults(NJ_DOI_INDEX_URL);
  if (!indexRes.ok) {
    throw new Error(
      `NJ DOI minutes index fetch failed: ${indexRes.status} ${indexRes.statusText}`,
    );
  }
  const html = await indexRes.text();
  const candidates = discoverNjDoiCandidates(html).slice(0, maxPdfs);
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

      const storagePath = `nj-doi/${hash}.pdf`;
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
 * Parse the SIC minutes-index HTML and return deduplicated candidates
 * sorted newest-first by meeting date. Exposed for tests.
 */
export function discoverNjDoiCandidates(html: string): NjDoiPdfCandidate[] {
  const $ = cheerio.load(html);
  const hrefs = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    if (NJ_DOI_PDF_HREF_RE.test(href)) hrefs.add(href);
    NJ_DOI_PDF_HREF_RE.lastIndex = 0;
  });
  for (const m of html.matchAll(NJ_DOI_PDF_HREF_RE)) {
    hrefs.add(m[0]);
  }

  const candidates: NjDoiPdfCandidate[] = [];
  for (const raw of hrefs) {
    const normalized = raw.startsWith("/")
      ? raw
      : `/treasury/doinvest/${raw.replace(/^\.?\//, "")}`;
    const url = `${NJ_DOI_BASE}${normalized}`;
    candidates.push({
      url,
      meetingDate: extractNjDoiMeetingDate(normalized),
    });
  }

  const byUrl = new Map<string, NjDoiPdfCandidate>();
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
const MONTH_ABBREV: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Extract meeting date from NJ DOI approved-minutes URL. Tries (in order
 * of specificity) month-name+day+year, MMDDYYYY, "MonthAbbrev DD-YYYY",
 * MMDDYY, MMYY, and "month_YY". Falls back to Jan 1 of the path year
 * when filename parsing fails so the row still sorts by correct year.
 * Returns null when even the path year is unrecoverable.
 */
export function extractNjDoiMeetingDate(href: string): string | null {
  const pathYearMatch = href.match(/\/ApprovedMinutes\/(\d{4})\//i);
  const pathYear = pathYearMatch ? parseInt(pathYearMatch[1], 10) : null;

  // 1. MonthName + DD + YYYY (e.g., October202025, January292025).
  const m1 = href.match(
    /(January|February|March|April|May|June|July|August|September|October|November|December)(\d{1,2})(\d{4})/i,
  );
  if (m1) {
    const month = MONTH_FULL[m1[1].toLowerCase()];
    const day = parseInt(m1[2], 10);
    const year = parseInt(m1[3], 10);
    if (validDate(year, month, day)) return iso(year, month, day);
  }

  // 2. MonthName + YYYY without day (e.g., minutesoctober2023).
  const m2 = href.match(
    /(January|February|March|April|May|June|July|August|September|October|November|December)(\d{4})/i,
  );
  if (m2) {
    const month = MONTH_FULL[m2[1].toLowerCase()];
    const year = parseInt(m2[2], 10);
    if (month && year >= 2000 && year <= 2100) return iso(year, month, 1);
  }

  // 3. Minutes + MMDDYYYY (e.g., Minutes10302024).
  const m3 = href.match(/Minutes(\d{2})(\d{2})(\d{4})(?!\d)/i);
  if (m3) {
    const mm = parseInt(m3[1], 10);
    const dd = parseInt(m3[2], 10);
    const yyyy = parseInt(m3[3], 10);
    if (validDate(yyyy, mm, dd)) return iso(yyyy, mm, dd);
  }

  // 4. MonthAbbrev + DD + "-YYYY" (e.g., Feb21-2008, Jan17-2008).
  const m4 = href.match(
    /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*(\d{1,2})[-_ ](\d{4})/i,
  );
  if (m4) {
    const month = MONTH_ABBREV[m4[1].toLowerCase()];
    const day = parseInt(m4[2], 10);
    const year = parseInt(m4[3], 10);
    if (month && validDate(year, month, day)) return iso(year, month, day);
  }

  // 5. ApprovedMinutes + MMDDYY (e.g., ApprovedMinutes070610 → 2010-07-06).
  const m5 = href.match(/ApprovedMinutes(\d{2})(\d{2})(\d{2})(?!\d)/i);
  if (m5) {
    const mm = parseInt(m5[1], 10);
    const dd = parseInt(m5[2], 10);
    let yy = parseInt(m5[3], 10);
    yy = yy < 80 ? 2000 + yy : 1900 + yy;
    if (validDate(yy, mm, dd)) return iso(yy, mm, dd);
  }

  // 6. ApprovedMinutes + MMYY (e.g., ApprovedMinutes0109 → 2009-01-01).
  const m6 = href.match(/ApprovedMinutes(\d{2})(\d{2})(?!\d)/i);
  if (m6) {
    const mm = parseInt(m6[1], 10);
    let yy = parseInt(m6[2], 10);
    yy = yy < 80 ? 2000 + yy : 1900 + yy;
    if (mm >= 1 && mm <= 12) return iso(yy, mm, 1);
  }

  // 7. approved_minutes_monthAbbrev_YY (e.g., approved_minutes_mar_08).
  const m7 = href.match(/approved_minutes_([a-z]{3,9})_(\d{2})/i);
  if (m7) {
    const month = MONTH_ABBREV[m7[1].slice(0, 3).toLowerCase()];
    let yy = parseInt(m7[2], 10);
    yy = yy < 80 ? 2000 + yy : 1900 + yy;
    if (month) return iso(yy, month, 1);
  }

  // 8. Fallback: use the /YYYY/ path segment so the row sorts by correct
  //    year. Classifier can still derive the exact date from the PDF.
  if (pathYear && pathYear >= 2000 && pathYear <= 2100) {
    return iso(pathYear, 1, 1);
  }
  return null;
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
