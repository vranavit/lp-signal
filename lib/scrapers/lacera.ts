import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchWithDefaults } from "./http";

/**
 * Los Angeles County Employees Retirement Association (LACERA).
 *
 *   Index pages:
 *     https://www.lacera.gov/leadership/board-meeting
 *     https://www.lacera.gov/accountability/boi-and-committees
 *
 *   Primary BOI PDFs:
 *     /sites/default/files/assets/documents/board/YYYY/BOI/
 *       YYYY-MM-DD-boi_agnd.pdf                   (agenda)
 *       YYYY-MM-DD-boi_min.pdf                    (minutes)
 *
 * Both index pages only surface current-year PDFs (~10 total at any
 * moment) — the Drupal view behind the "archived" link filters older
 * years via client-side JS that our fetch never executes. URLs for
 * older meetings are still publicly reachable at their canonical path
 * though: spot-check of six 2024 + 2025 dates returned 200 for each
 * that corresponded to an actual meeting (BOI meets 2nd Wednesday of
 * each month, with occasional summer skips).
 *
 * Strategy is hybrid:
 *   1. Scrape both index pages for all PDF hrefs they surface.
 *   2. Generate probe candidates by walking every Wednesday/Tuesday of
 *      every month in the last `monthsBack` months and emitting both
 *      `_agnd.pdf` and `_min.pdf` variants. Canonical meeting day is
 *      Wednesday; Tuesday catches the occasional one-day shift.
 *   3. Fetch each candidate; 404 is expected and absorbed into the
 *      notFound counter so the health-check cron doesn't alert on
 *      benign misses.
 *
 * Real Assets Committee, Credit & Risk Mitigation, Corporate Governance
 * etc. also publish agendas under the same /BOI/ folder — those are
 * harvested via the index hrefs but not probe-generated.
 */
const LACERA_BASE = "https://www.lacera.gov";
const LACERA_INDEX_URLS = [
  `${LACERA_BASE}/leadership/board-meeting`,
  `${LACERA_BASE}/accountability/boi-and-committees`,
];
const STORAGE_BUCKET = "documents";

const LACERA_PDF_HREF_RE =
  /\/sites\/default\/files\/assets\/documents\/board\/\d{4}\/[^"'\s]+\.pdf/gi;

export type LaceraScrapeResult = {
  indexCandidates: number;
  probeCandidates: number;
  candidateUrlsProbed: number;
  pdfsFetched: number;
  inserted: number;
  skipped: number;
  notFound: number;
  errors: { url: string; message: string }[];
  totalBytes: number;
};

export type LaceraCandidate = {
  url: string;
  meetingDate: string | null;
  source: "index" | "probe";
  kind: "agenda" | "minutes" | "other";
};

export async function scrapeLacera(
  supabase: SupabaseClient,
  opts: { planId: string; monthsBack?: number; now?: Date; maxCandidates?: number },
): Promise<LaceraScrapeResult> {
  if (!opts.planId) throw new Error("scrapeLacera requires opts.planId");
  const monthsBack = opts.monthsBack ?? 18;
  const maxCandidates = opts.maxCandidates ?? 400;

  const result: LaceraScrapeResult = {
    indexCandidates: 0,
    probeCandidates: 0,
    candidateUrlsProbed: 0,
    pdfsFetched: 0,
    inserted: 0,
    skipped: 0,
    notFound: 0,
    errors: [],
    totalBytes: 0,
  };

  const indexCandidates: LaceraCandidate[] = [];
  for (const indexUrl of LACERA_INDEX_URLS) {
    try {
      const res = await fetchWithDefaults(indexUrl);
      if (!res.ok) {
        result.errors.push({
          url: indexUrl,
          message: `index HTTP ${res.status}`,
        });
        continue;
      }
      const html = await res.text();
      indexCandidates.push(...discoverLaceraIndexCandidates(html));
    } catch (err) {
      result.errors.push({
        url: indexUrl,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  result.indexCandidates = indexCandidates.length;

  const probeCandidates = generateLaceraProbeCandidates(monthsBack, opts.now);
  result.probeCandidates = probeCandidates.length;

  // De-dup across sources (probe and index may suggest the same URL).
  const byUrl = new Map<string, LaceraCandidate>();
  for (const c of indexCandidates) byUrl.set(c.url, c);
  for (const c of probeCandidates) {
    if (!byUrl.has(c.url)) byUrl.set(c.url, c);
  }
  const candidates = Array.from(byUrl.values()).slice(0, maxCandidates);

  for (const cand of candidates) {
    result.candidateUrlsProbed += 1;
    try {
      const res = await fetchWithDefaults(cand.url);
      if (res.status === 404) {
        result.notFound += 1;
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
        // Drupal 404 page occasionally returns HTML 200; treat as not-found.
        result.notFound += 1;
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

      const storagePath = `lacera/${hash}.pdf`;
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
 * Extract all LACERA board PDF hrefs from an index-page HTML blob.
 * Exposed for tests.
 */
export function discoverLaceraIndexCandidates(html: string): LaceraCandidate[] {
  const $ = cheerio.load(html);
  const hrefs = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    if (LACERA_PDF_HREF_RE.test(href)) hrefs.add(href);
    LACERA_PDF_HREF_RE.lastIndex = 0;
  });
  for (const m of html.matchAll(LACERA_PDF_HREF_RE)) {
    hrefs.add(m[0]);
  }

  const out: LaceraCandidate[] = [];
  for (const raw of hrefs) {
    const url = raw.startsWith("http") ? raw : `${LACERA_BASE}${raw}`;
    out.push({
      url,
      meetingDate: extractLaceraMeetingDate(raw),
      source: "index",
      kind: classifyLaceraKind(raw),
    });
  }
  return out;
}

/**
 * Generate candidate BOI URLs for meetings over the last `monthsBack`
 * months. LACERA BOI meets on Wednesdays; occasional off-Wednesday
 * meetings historically fall on Tuesday. We emit both days for every
 * week of the meeting month, across `_agnd.pdf` and `_min.pdf` variants.
 */
export function generateLaceraProbeCandidates(
  monthsBack: number,
  now = new Date(),
): LaceraCandidate[] {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - monthsBack);
  const out: LaceraCandidate[] = [];

  const cursor = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  while (cursor < end) {
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth() + 1;
    // Tuesday = day 2, Wednesday = day 3 of month where the 2nd Wed
    // typically falls. We probe both Tues + Wed of each week so a 1-day
    // shift still lands on a real meeting filename.
    for (const weekday of [2, 3]) {
      for (const d of weekdaysOfMonth(y, m, weekday)) {
        const date = new Date(Date.UTC(y, m - 1, d));
        if (date < cutoff || date > now) continue;
        const dateStr = date.toISOString().slice(0, 10);
        const base = `${LACERA_BASE}/sites/default/files/assets/documents/board/${y}/BOI/${dateStr}`;
        out.push({
          url: `${base}-boi_agnd.pdf`,
          meetingDate: dateStr,
          source: "probe",
          kind: "agenda",
        });
        out.push({
          url: `${base}-boi_min.pdf`,
          meetingDate: dateStr,
          source: "probe",
          kind: "minutes",
        });
      }
    }
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

function weekdaysOfMonth(year: number, month1Indexed: number, weekday: number): number[] {
  const out: number[] = [];
  const first = new Date(Date.UTC(year, month1Indexed - 1, 1));
  const diff = (weekday - first.getUTCDay() + 7) % 7;
  for (let d = 1 + diff; d <= 31; d += 7) {
    const probe = new Date(Date.UTC(year, month1Indexed - 1, d));
    if (probe.getUTCMonth() !== month1Indexed - 1) break;
    out.push(d);
  }
  return out;
}

/**
 * Extract meeting date from a LACERA PDF path. Recognizes the canonical
 * YYYY-MM-DD prefix used on all /board/YYYY/BOI/ PDFs.
 */
export function extractLaceraMeetingDate(path: string): string | null {
  const m = path.match(/\/board\/\d{4}\/[^/]+\/(\d{4}-\d{2}-\d{2})-/);
  if (m) return m[1];
  // Report-out variant: BOI_MM-DD-YY_report-out.pdf
  const m2 = path.match(/BOI_(\d{1,2})-(\d{1,2})-(\d{2})_/);
  if (m2) {
    const mm = parseInt(m2[1], 10);
    const dd = parseInt(m2[2], 10);
    let yy = parseInt(m2[3], 10);
    yy = yy < 80 ? 2000 + yy : 1900 + yy;
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${yy}-${pad(mm)}-${pad(dd)}`;
    }
  }
  // Fallback: year from path.
  const yrMatch = path.match(/\/board\/(\d{4})\//);
  if (yrMatch) return `${yrMatch[1]}-01-01`;
  return null;
}

function classifyLaceraKind(path: string): "agenda" | "minutes" | "other" {
  if (/_min\.pdf$/i.test(path)) return "minutes";
  if (/_agnd\.pdf$|[-_]agenda\.pdf$/i.test(path)) return "agenda";
  return "other";
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}
