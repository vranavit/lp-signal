import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchText } from "../http";

/**
 * CalPERS plan-side press release scraper. Single-level crawl off the
 * /newsroom/calpers-news index — the page renders all releases server-side
 * grouped by year, so a plain GET + Cheerio walk is sufficient. No JS
 * execution, no Storage upload (HTML body lives in documents.content_text).
 *
 * URL pattern (verified Day 1):
 *   Index:    https://www.calpers.ca.gov/newsroom/calpers-news
 *   Release:  /newsroom/calpers-news/{year}/{slug}
 *
 * Per-document dedup via content_hash uniqueness check against the
 * documents table. Source-level fingerprinting is handled by the
 * `runScrapeCron` wrapper at the cron-route layer (matches every other
 * scraper in this directory). The scraper returns `insertedUrls` so the
 * route can build a stable hashHint via `summarizeStringList`.
 */

export const CALPERS_PRESS_INDEX =
  "https://www.calpers.ca.gov/newsroom/calpers-news";

const FETCH_DELAY_MS = 500;
const MIN_BODY_TEXT_LENGTH = 200;

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
  dateHint: string | null;
};

export async function scrapeCalPERSPressReleases(
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
      .eq("name", "CalPERS")
      .maybeSingle();
    if (error || !plan) {
      throw new Error(
        `CalPERS plan row not found: ${error?.message ?? "no row"}`,
      );
    }
    planId = plan.id;
  }

  const indexHtml = await fetchText(CALPERS_PRESS_INDEX);
  const $ = cheerio.load(indexHtml);
  const seen = new Set<string>();
  const releases: DiscoveredRelease[] = [];

  $('a[href*="/newsroom/calpers-news/"]').each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const abs = new URL(href, CALPERS_PRESS_INDEX).toString();

    // Filter: must be /newsroom/calpers-news/{4-digit year}/{non-empty slug}
    if (!/\/newsroom\/calpers-news\/\d{4}\/[^/?#]+/.test(abs)) return;
    if (seen.has(abs)) return;
    seen.add(abs);

    const titleHint = $(el).text().trim();
    // The CalPERS markup wraps each release in a <li> with the date as a
    // text node sibling of the anchor. Capture sibling text nodes only —
    // child elements would re-include the link text we already have.
    const parent = $(el).parent();
    const dateText = parent
      .contents()
      .filter((_i, n) => n.type === "text")
      .text()
      .replace(/\s+/g, " ")
      .trim();
    const dateHint = dateText.length > 0 ? dateText : null;

    releases.push({ url: abs, titleHint, dateHint });
  });

  result.releasesFound = releases.length;

  if (releases.length === 0) {
    throw new Error(
      "CalPERS press release scraper: 0 release links matched the expected " +
        "URL pattern. The page structure may have changed.",
    );
  }

  const toProcess = releases.slice(0, maxReleases);

  for (let i = 0; i < toProcess.length; i++) {
    const r = toProcess[i];
    try {
      const html = await fetchText(r.url);
      const $a = cheerio.load(html);

      // Strip noise from text extraction (preserves HTML for date parsing
      // already done above).
      $a("script, style, nav, header, footer, aside").remove();

      let body = $a("article").first();
      if (!body.length) body = $a("main").first();
      if (!body.length) body = $a("body").first();

      const text = body.text().replace(/\s+/g, " ").trim();
      if (text.length < MIN_BODY_TEXT_LENGTH) {
        result.errors.push({
          url: r.url,
          message: `body too short after extraction (${text.length} chars)`,
        });
        continue;
      }

      let publishedAt: string | null = null;
      const datetimeAttr = $a("time[datetime]").attr("datetime");
      if (datetimeAttr) {
        const d = new Date(datetimeAttr);
        if (!Number.isNaN(d.getTime())) publishedAt = d.toISOString();
      }
      if (!publishedAt && r.dateHint) {
        const d = new Date(r.dateHint);
        if (!Number.isNaN(d.getTime())) publishedAt = d.toISOString();
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
