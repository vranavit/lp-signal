import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchWithDefaults } from "./http";

/**
 * Oregon Investment Council (OIC) — manages Oregon PERS + SAIF + other state
 * investment funds. Primary commitment-disclosure channel.
 *
 *   Index page:  https://www.oregon.gov/treasury/invested-for-oregon/pages/oregon-investment-council.aspx
 *
 * The index lists current-year meetings with links to:
 *   /treasury/invested-for-oregon/Documents/Invested-for-OR-47OIC-Agenda-and-Minutes/YYYY/*-Public-Book.pdf   (meeting packet)
 *   /treasury/invested-for-oregon/Documents/Invested-for-OR-47OIC-Agenda-and-Minutes/Minutes/YYYY/*.pdf       (approved minutes)
 *
 * The filename format is inconsistent ("04.15.26-OIC-PUBLIC-Book.pdf" vs
 * "Regular-Meeting-January-21-2026.pdf") so we rely on the index page for
 * hrefs rather than generating candidates. Meeting date is extracted from
 * the href where possible; falls back to the approved-minutes filename.
 *
 * A supplementary archive page exists for older years but meaningful
 * commitment signals age out fast; we scope to the 8 meetings/year on the
 * main page and rely on content-hash dedup to skip unchanged runs.
 */
export const OIC_INDEX_URL =
  "https://www.oregon.gov/treasury/invested-for-oregon/pages/oregon-investment-council.aspx";
const OIC_BASE = "https://www.oregon.gov";
const STORAGE_BUCKET = "documents";

// Either the meeting-packet or minutes folder under the OIC documents tree.
const OIC_PDF_HREF_RE =
  /\/treasury\/invested-for-oregon\/Documents\/Invested-for-OR-47OIC-Agenda-and-Minutes\/(?:Minutes\/)?\d{4}\/[^"'\s]+\.pdf/gi;

export type OregonScrapeResult = {
  candidatesFound: number;
  pdfsFetched: number;
  inserted: number;
  skipped: number;
  errors: { url: string; message: string }[];
  totalBytes: number;
};

export type OregonPdfCandidate = {
  url: string;
  meetingDate: string | null;
  // "packet" = Public-Book meeting packet; "minutes" = approved minutes.
  kind: "packet" | "minutes";
};

export async function scrapeOregon(
  supabase: SupabaseClient,
  opts: { planId: string; maxPdfs?: number },
): Promise<OregonScrapeResult> {
  if (!opts.planId) throw new Error("scrapeOregon requires opts.planId");
  const maxPdfs = opts.maxPdfs ?? 20;

  const result: OregonScrapeResult = {
    candidatesFound: 0,
    pdfsFetched: 0,
    inserted: 0,
    skipped: 0,
    errors: [],
    totalBytes: 0,
  };

  const indexRes = await fetchWithDefaults(OIC_INDEX_URL);
  if (!indexRes.ok) {
    throw new Error(
      `Oregon OIC index fetch failed: ${indexRes.status} ${indexRes.statusText}`,
    );
  }
  const html = await indexRes.text();
  const candidates = discoverOregonCandidates(html).slice(0, maxPdfs);
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

      const storagePath = `oregon/${hash}.pdf`;
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
 * Pull OIC PDF hrefs from the index page, tag each as packet or minutes, and
 * infer meeting date from the filename. Exposed for tests.
 */
export function discoverOregonCandidates(html: string): OregonPdfCandidate[] {
  const $ = cheerio.load(html);
  // Combine href attrs and raw-text matches to catch both anchored links and
  // any stray URL references.
  const hrefs = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    if (OIC_PDF_HREF_RE.test(href)) hrefs.add(href);
    OIC_PDF_HREF_RE.lastIndex = 0;
  });
  for (const m of html.matchAll(OIC_PDF_HREF_RE)) {
    hrefs.add(m[0]);
  }

  const candidates: OregonPdfCandidate[] = [];
  for (const raw of hrefs) {
    const url = raw.startsWith("http") ? raw : `${OIC_BASE}${raw}`;
    const kind: "minutes" | "packet" = /\/Minutes\//i.test(raw)
      ? "minutes"
      : "packet";
    candidates.push({
      url,
      kind,
      meetingDate: extractOregonMeetingDate(raw),
    });
  }

  // De-dup on URL, sort newest first by meetingDate when known.
  const byUrl = new Map<string, OregonPdfCandidate>();
  for (const c of candidates) byUrl.set(c.url, c);
  return Array.from(byUrl.values()).sort((a, b) => {
    const da = a.meetingDate ?? "";
    const db = b.meetingDate ?? "";
    return db.localeCompare(da);
  });
}

/**
 * Best-effort meeting date extraction. Recognizes three filename shapes
 * observed on the live OIC index:
 *   04.15.26-OIC-PUBLIC-Book.pdf
 *   1-22-2025-Meeting-Minutes-final.pdf
 *   Regular-Meeting-January-21-2026.pdf
 * Returns null when nothing plausible is found — callers still accept the
 * PDF (meeting_date column is nullable) and the classifier will derive
 * approval_date from the document body where possible.
 */
export function extractOregonMeetingDate(href: string): string | null {
  // 04.15.26 or 04-15-26 → 2026-04-15
  const dotted = href.match(/(\d{1,2})[.\-](\d{1,2})[.\-](\d{2,4})/);
  if (dotted) {
    const mm = parseInt(dotted[1], 10);
    const dd = parseInt(dotted[2], 10);
    let yy = parseInt(dotted[3], 10);
    if (yy < 100) yy += 2000;
    if (validDate(yy, mm, dd)) return iso(yy, mm, dd);
  }
  // "Regular-Meeting-January-21-2026" / "January-21-2026"
  const monthNames: Record<string, number> = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };
  const re = /([A-Za-z]+)[-_ ](\d{1,2})[-_,](\d{4})/;
  const m = href.match(re);
  if (m) {
    const mn = monthNames[m[1].toLowerCase()];
    const dd = parseInt(m[2], 10);
    const yy = parseInt(m[3], 10);
    if (mn && validDate(yy, mn, dd)) return iso(yy, mn, dd);
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
