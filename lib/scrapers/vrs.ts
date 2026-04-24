import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchWithDefaults } from "./http";

/**
 * Virginia Retirement System (VRS).
 *
 *   Index page:  https://www.varetire.org/about/board/meetings/
 *
 * The single Board Meetings & Minutes page is server-rendered and lists
 * every Board of Trustees / Investment Advisory Committee / committee PDF
 * published in the last 12-18 months under three folders:
 *
 *   /media/members/pdf/board/agendas/YYYY/*.pdf
 *   /media/members/pdf/board/materials/YYYY/*.pdf
 *   /media/members/pdf/board/minutes/YYYY/*.pdf
 *
 * Filenames encode the meeting date at the end, e.g.
 *   board-of-trustees-agenda-04-23-26.pdf
 *   bot-06-18-25.pdf                         (materials use short codes)
 *   iac-meeting-minutes-08-20-25.pdf
 *   administration-finance-talent-agenda-5-20-25.pdf  (single-digit month)
 *   acc-06-17-2025.pdf                        (occasional 4-digit year)
 *
 * The three doc kinds correlate with VRS's three-layer meeting cycle:
 *   - agendas  = pre-meeting preview
 *   - materials = full meeting packets (highest signal density)
 *   - minutes  = post-meeting transcript / record
 *
 * We ingest all three but the classifier will extract commitment signals
 * primarily from materials + minutes. Agendas are low-density but cheap
 * and help us detect meeting dates when minutes lag.
 */
export const VRS_INDEX_URL =
  "https://www.varetire.org/about/board/meetings/";
const VRS_BASE = "https://www.varetire.org";
const STORAGE_BUCKET = "documents";

// Captures /media/members/pdf/board/{agendas,materials,minutes}/YYYY/*.pdf
// hrefs. Tolerant of both absolute and site-relative forms.
const VRS_PDF_HREF_RE =
  /\/media\/members\/pdf\/board\/(?:agendas|materials|minutes)\/\d{4}\/[^"'\s]+\.pdf/gi;

export type VrsScrapeResult = {
  candidatesFound: number;
  pdfsFetched: number;
  inserted: number;
  skipped: number;
  errors: { url: string; message: string }[];
  totalBytes: number;
};

export type VrsPdfCandidate = {
  url: string;
  meetingDate: string | null;
  // "agenda" = pre-meeting preview; "materials" = meeting packet;
  // "minutes" = post-meeting record.
  kind: "agenda" | "materials" | "minutes";
};

export async function scrapeVrs(
  supabase: SupabaseClient,
  opts: { planId: string; maxPdfs?: number },
): Promise<VrsScrapeResult> {
  if (!opts.planId) throw new Error("scrapeVrs requires opts.planId");
  const maxPdfs = opts.maxPdfs ?? 25;

  const result: VrsScrapeResult = {
    candidatesFound: 0,
    pdfsFetched: 0,
    inserted: 0,
    skipped: 0,
    errors: [],
    totalBytes: 0,
  };

  const indexRes = await fetchWithDefaults(VRS_INDEX_URL);
  if (!indexRes.ok) {
    throw new Error(
      `VRS meetings index fetch failed: ${indexRes.status} ${indexRes.statusText}`,
    );
  }
  const html = await indexRes.text();
  const candidates = discoverVrsCandidates(html).slice(0, maxPdfs);
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

      const storagePath = `vrs/${hash}.pdf`;
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
 * Parse VRS meeting-index HTML and return de-duplicated PDF candidates,
 * sorted newest-first by meeting date. Exposed for tests.
 */
export function discoverVrsCandidates(html: string): VrsPdfCandidate[] {
  const $ = cheerio.load(html);
  const hrefs = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    if (VRS_PDF_HREF_RE.test(href)) hrefs.add(href);
    VRS_PDF_HREF_RE.lastIndex = 0;
  });
  for (const m of html.matchAll(VRS_PDF_HREF_RE)) {
    hrefs.add(m[0]);
  }

  const candidates: VrsPdfCandidate[] = [];
  for (const raw of hrefs) {
    const url = raw.startsWith("http") ? raw : `${VRS_BASE}${raw}`;
    let kind: "agenda" | "materials" | "minutes";
    if (/\/minutes\//i.test(raw)) kind = "minutes";
    else if (/\/materials\//i.test(raw)) kind = "materials";
    else kind = "agenda";
    candidates.push({
      url,
      kind,
      meetingDate: extractVrsMeetingDate(raw),
    });
  }

  const byUrl = new Map<string, VrsPdfCandidate>();
  for (const c of candidates) byUrl.set(c.url, c);
  return Array.from(byUrl.values()).sort((a, b) => {
    const da = a.meetingDate ?? "";
    const db = b.meetingDate ?? "";
    return db.localeCompare(da);
  });
}

/**
 * Extract meeting date from a VRS PDF href. Recognizes trailing
 * `M-D-YY`, `MM-DD-YY`, or `MM-DD-YYYY` before `.pdf`. Returns YYYY-MM-DD
 * or null when nothing plausible is found.
 */
export function extractVrsMeetingDate(href: string): string | null {
  // Match M{1,2}-D{1,2}-Y{2,4} at end of filename.
  const m = href.match(/(\d{1,2})-(\d{1,2})-(\d{2,4})\.pdf$/i);
  if (!m) return null;
  const mm = parseInt(m[1], 10);
  const dd = parseInt(m[2], 10);
  let yy = parseInt(m[3], 10);
  if (yy < 100) yy += 2000;
  if (!validDate(yy, mm, dd)) return null;
  return iso(yy, mm, dd);
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
