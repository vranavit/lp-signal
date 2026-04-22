import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchWithDefaults } from "./http";

/**
 * Michigan SMRS (State Michigan Retirement System) — investments managed by
 * Michigan Treasury Bureau of Investments; the State of Michigan Investment
 * Board (SMIB) meets ~quarterly and publishes a report per meeting.
 *
 *   Index page:  https://www.michigan.gov/treasury/about/investments/quarterly
 *   PDF paths:   /treasury/-/media/Project/Websites/treasury/SMIB/{YYYY}/{slug}.pdf?rev=...
 *   Filename variants seen in 2023–2026:
 *     - {Month}-{YYYY}-SMIB-Report.pdf                (e.g. December-2025-SMIB-Report.pdf)
 *     - SMIB-Report-{MDDYYYY}.pdf                     (e.g. SMIB-Report-3252026.pdf)
 *     - SMIB-Report-{YYYYMD}.pdf                      (e.g. SMIB-Report-202542.pdf)
 *     - {Month}-{YYYY}-SMIB-Report_web.pdf            (occasional)
 *   Also per meeting: Presentation / Attachment PDFs — those are supplementary
 *   slides/appendices, skipped (commitments are disclosed in the main Report).
 *
 * We parse the anchor TEXT ("March 2026 SMIB Report") for date + type rather
 * than the filename (too many variants). michigan.gov's WAF requires the
 * Sec-Fetch-* headers our shared fetchWithDefaults sets.
 */
export const MICHIGAN_INDEX_URL =
  "https://www.michigan.gov/treasury/about/investments/quarterly";
const STORAGE_BUCKET = "documents";

const MONTH_NAME_TO_NUM: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const REPORT_TEXT_RE = /^(\w+)\s+(\d{4})\s+SMIB\s+Report\s*$/i;

export type MichiganScrapeResult = {
  reportsFound: number;
  candidatesConsidered: number;
  pdfsFetched: number;
  inserted: number;
  skipped: number;
  errors: { url: string; message: string }[];
  totalBytes: number;
};

export type MichiganReportCandidate = {
  url: string;
  meetingDate: string;
  label: string;
};

export async function scrapeMichigan(
  supabase: SupabaseClient,
  opts: { planId: string; monthsBack?: number },
): Promise<MichiganScrapeResult> {
  if (!opts.planId) throw new Error("scrapeMichigan requires opts.planId");
  const monthsBack = opts.monthsBack ?? 6;

  const result: MichiganScrapeResult = {
    reportsFound: 0,
    candidatesConsidered: 0,
    pdfsFetched: 0,
    inserted: 0,
    skipped: 0,
    errors: [],
    totalBytes: 0,
  };

  const indexRes = await fetchWithDefaults(MICHIGAN_INDEX_URL);
  if (!indexRes.ok) {
    throw new Error(
      `Michigan index fetch failed: ${indexRes.status} ${indexRes.statusText}`,
    );
  }
  const html = await indexRes.text();
  const candidates = discoverMichiganReports(html, monthsBack);
  result.reportsFound = candidates.length;
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

      const storagePath = `michigan/${hash}.pdf`;
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
 * Extract SMIB Report candidates from the quarterly index page. Filters out
 * Presentation and Attachment PDFs (supplementary — commitments are in the
 * main Report). Parses month/year from the anchor text.
 */
export function discoverMichiganReports(
  html: string,
  monthsBack: number,
  now: Date = new Date(),
): MichiganReportCandidate[] {
  const $ = cheerio.load(html);
  const cutoffMs = now.getTime() - monthsBack * 31 * 86_400_000;
  const byDate = new Map<string, MichiganReportCandidate>();

  $("a").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    // Limit to SMIB folder, PDFs only.
    if (!/\/SMIB\//i.test(href)) return;
    if (!/\.pdf(\?|$)/i.test(href)) return;
    // Skip supplementary materials — commitments are in the main Report.
    if (/Presentation|Attachment/i.test(href)) return;

    const text = ($(el).text() || "").trim();
    const m = text.match(REPORT_TEXT_RE);
    if (!m) return;
    const [, monthName, yearStr] = m;
    const monthNum = MONTH_NAME_TO_NUM[monthName.toLowerCase()];
    if (!monthNum) return;
    const year = Number(yearStr);
    const meetingDate = `${year}-${String(monthNum).padStart(2, "0")}-01`;
    const tsMs = Date.parse(`${meetingDate}T00:00:00Z`);
    if (!Number.isFinite(tsMs) || tsMs < cutoffMs) return;

    const abs = new URL(href, MICHIGAN_INDEX_URL).toString();
    if (!byDate.has(meetingDate)) {
      byDate.set(meetingDate, {
        url: abs,
        meetingDate,
        label: `${monthName} ${year}`,
      });
    }
  });

  return Array.from(byDate.values()).sort((a, b) =>
    b.meetingDate.localeCompare(a.meetingDate),
  );
}
