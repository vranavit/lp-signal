import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchText } from "../http";

/**
 * Oregon State Treasury press release scraper. Single-level crawl off
 * the OST newsroom index. Same architecture as the CalPERS / CalSTRS
 * press scrapers: server-rendered HTML, no JS execution, no Storage
 * upload (HTML body lives in documents.content_text).
 *
 * Verified 2026-04-30: fetchWithDefaults clears the apps.oregon.gov
 * subdomain cleanly with the existing Chrome 132 UA.
 *
 * Index structure: post links at /oregon-newsroom/OR/OST/Posts/Post/{slug}.
 * The page renders 30+ unique posts server-side; each post link appears
 * twice (image-wrapper + title-wrapper) so dedup via URL Set is
 * required. Feed is mixed — covers all OST press, not just OIC/OPERF
 * pension news. Of ~30 visible posts, roughly half are pension/OIC
 * relevant; the classifier prompt rejects non-pension content as
 * noise (consistent with the CalPERS/CalSTRS pattern).
 *
 * Per-document dedup via content_hash. Source-level fingerprinting
 * handled by runScrapeCron at the cron-route layer.
 */

export const OREGON_PRESS_INDEX =
  "https://apps.oregon.gov/oregon-newsroom/OR/OST/Posts";

const FETCH_DELAY_MS = 500;
const MIN_BODY_TEXT_LENGTH = 200;
// Common date formats seen in OST posts: "October 22, 2025" / "March 4, 2026" /
// "Dec 8, 2025". Match either spelled-out month or 3-letter abbreviation.
const DATE_RE =
  /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2},\s*\d{4}\b/;

export type ScrapeResult = {
  releasesFound: number;
  inserted: number;
  skipped: number;
  errors: { url: string; message: string }[];
  insertedUrls: string[];
};

type DiscoveredRelease = {
  url: string;
  titleHint: string;
};

export async function scrapeOregonPressReleases(
  supabase: SupabaseClient,
  opts: { planId?: string; maxReleases?: number } = {},
): Promise<ScrapeResult> {
  const maxReleases = opts.maxReleases ?? 25;
  const result: ScrapeResult = {
    releasesFound: 0,
    inserted: 0,
    skipped: 0,
    errors: [],
    insertedUrls: [],
  };

  let planId = opts.planId;
  if (!planId) {
    const { data: plan, error } = await supabase
      .from("plans")
      .select("id")
      .eq("name", "Oregon PERS")
      .maybeSingle();
    if (error || !plan) {
      throw new Error(
        `Oregon PERS plan row not found: ${error?.message ?? "no row"}`,
      );
    }
    planId = plan.id;
  }

  const indexHtml = await fetchText(OREGON_PRESS_INDEX);
  const $ = cheerio.load(indexHtml);
  const seen = new Set<string>();
  const releases: DiscoveredRelease[] = [];

  $('a[href*="/oregon-newsroom/OR/OST/Posts/Post/"]').each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const abs = new URL(href, OREGON_PRESS_INDEX).toString();
    if (seen.has(abs)) return;
    seen.add(abs);

    // Anchor text on the title-wrapper carries the headline. The
    // image-wrapper anchor for the same URL has empty text — we capture
    // whichever non-empty version we see first.
    const titleHint = $(el).text().replace(/\s+/g, " ").trim();
    releases.push({ url: abs, titleHint });
  });

  result.releasesFound = releases.length;

  if (releases.length === 0) {
    throw new Error(
      "Oregon press release scraper: 0 release links discovered. The " +
        "page structure may have changed.",
    );
  }

  const toProcess = releases.slice(0, maxReleases);

  for (let i = 0; i < toProcess.length; i++) {
    const r = toProcess[i];
    try {
      const html = await fetchText(r.url);
      const $a = cheerio.load(html);

      $a("script, style, nav, header, footer, aside").remove();

      let body = $a("article").first();
      if (!body.length) body = $a("main").first();
      if (!body.length) body = $a("body").first();

      const text = body.text().replace(/\s+/g, " ").trim();
      if (text.length < MIN_BODY_TEXT_LENGTH) {
        // Empty / placeholder pages get a silent skip rather than a
        // logged error.
        continue;
      }

      let publishedAt: string | null = null;
      const datetimeAttr = $a("time[datetime]").attr("datetime");
      if (datetimeAttr) {
        const d = new Date(datetimeAttr);
        if (!Number.isNaN(d.getTime())) publishedAt = d.toISOString();
      }
      if (!publishedAt) {
        const m = text.match(DATE_RE);
        if (m) {
          const d = new Date(m[0]);
          if (!Number.isNaN(d.getTime())) publishedAt = d.toISOString();
        }
      }
      const meetingDate = publishedAt ? publishedAt.slice(0, 10) : null;

      const contentHash = createHash("sha256").update(text).digest("hex");

      const { data: existing } = await supabase
        .from("documents")
        .select("id")
        .eq("plan_id", planId)
        .eq("content_hash", contentHash)
        .maybeSingle();

      if (existing) {
        result.skipped += 1;
      } else {
        const { error: insErr } = await supabase.from("documents").insert({
          plan_id: planId,
          document_type: "press_release",
          source_url: r.url,
          content_hash: contentHash,
          content_text: text,
          storage_path: null,
          meeting_date: meetingDate,
          published_at: publishedAt,
          processing_status: "pending",
        });
        if (insErr) throw insErr;
        result.inserted += 1;
        result.insertedUrls.push(r.url);
      }

      if (i < toProcess.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, FETCH_DELAY_MS));
      }
    } catch (err) {
      result.errors.push({
        url: r.url,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await supabase
    .from("plans")
    .update({ last_scraped_at: new Date().toISOString() })
    .eq("id", planId);

  return result;
}
