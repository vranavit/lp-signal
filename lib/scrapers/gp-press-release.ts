/**
 * Shared utilities for GP-side press-release scrapers (Blackstone, KKR, Apollo).
 * Each GP gets a thin wrapper (see `lib/scrapers/blackstone.ts`) that supplies
 * three selectors: the index URL, an article-URL filter, and an article-text
 * extractor. Everything else — keyword filter, hashing, storage — lives here.
 */

import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ExtractedArticle = {
  url: string;
  title: string;
  publishedAt: string | null; // ISO 8601 timestamp when available
  text: string;
};

// Intentionally loose — scrape-stage filter catches anything that could
// plausibly be an LP-commitment signal. The classifier is the precision gate.
export const GP_KEYWORDS = [
  /\bfinal close\b/i,
  /\bcloses on\b/i,
  /\bcommitments? from\b/i,
  /\bLPs?\b/,
  /\blimited partner/i,
  /\bpension/i,
  /\bendowment/i,
  /\bsovereign wealth\b/i,
  /\binstitutional investors?\b/i,
];

export function matchedKeywords(text: string): string[] {
  return GP_KEYWORDS.filter((re) => re.test(text)).map((re) => re.source);
}

export const GP_USER_AGENT =
  "Mozilla/5.0 (compatible; lp-signal/0.1; +https://github.com/vranavit/lp-signal)";

export async function fetchHtml(url: string, timeoutMs = 20_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": GP_USER_AGENT,
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export function cleanText(raw: string): string {
  return raw
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type GpScraperConfig = {
  gpName: string;
  indexUrl: string;
  // Extract absolute article URLs from the index HTML.
  discoverFromIndex: (html: string, $: cheerio.CheerioAPI) => string[];
  // Extract title, published_at, and main body text from an article page.
  extractArticle: (
    html: string,
    $: cheerio.CheerioAPI,
    url: string,
  ) => ExtractedArticle;
};

export type ScrapeResult = {
  found: number;
  processed: number;
  kept: number;
  filtered_old: number;
  filtered_no_keywords: number;
  filtered_too_short: number;
  skipped_duplicate: number;
  errors: { url: string; message: string }[];
  inserted: ExtractedArticle[];
};

export async function scrapeGpPressReleases(
  supabase: SupabaseClient,
  config: GpScraperConfig,
  opts: { daysBack?: number; maxKept?: number; maxProbed?: number } = {},
): Promise<ScrapeResult> {
  const daysBack = opts.daysBack ?? 60;
  const maxKept = opts.maxKept ?? 20;
  const maxProbed = opts.maxProbed ?? 40;

  const result: ScrapeResult = {
    found: 0,
    processed: 0,
    kept: 0,
    filtered_old: 0,
    filtered_no_keywords: 0,
    filtered_too_short: 0,
    skipped_duplicate: 0,
    errors: [],
    inserted: [],
  };

  const { data: gp, error: gpErr } = await supabase
    .from("gps")
    .select("id, name")
    .eq("name", config.gpName)
    .single();
  if (gpErr || !gp) {
    throw new Error(`GP '${config.gpName}' not seeded: ${gpErr?.message}`);
  }

  const indexHtml = await fetchHtml(config.indexUrl);
  const $idx = cheerio.load(indexHtml);
  const articleUrls = Array.from(new Set(config.discoverFromIndex(indexHtml, $idx)));
  result.found = articleUrls.length;

  const cutoffMs = Date.now() - daysBack * 86_400_000;

  for (const url of articleUrls.slice(0, maxProbed)) {
    if (result.kept >= maxKept) break;
    result.processed += 1;

    try {
      const html = await fetchHtml(url);
      const $art = cheerio.load(html);
      const art = config.extractArticle(html, $art, url);

      if (art.text.length < 200) {
        result.filtered_too_short += 1;
        continue;
      }
      if (art.publishedAt) {
        const ts = new Date(art.publishedAt).getTime();
        if (Number.isFinite(ts) && ts < cutoffMs) {
          result.filtered_old += 1;
          continue;
        }
      }
      const keywordsHit = matchedKeywords(art.text);
      if (keywordsHit.length === 0) {
        result.filtered_no_keywords += 1;
        continue;
      }

      const hash = createHash("sha256").update(art.text).digest("hex");
      const { data: existing } = await supabase
        .from("documents")
        .select("id")
        .eq("content_hash", hash)
        .maybeSingle();
      if (existing) {
        result.skipped_duplicate += 1;
        continue;
      }

      const meetingDate = art.publishedAt
        ? art.publishedAt.slice(0, 10)
        : null;

      const { error: insErr } = await supabase.from("documents").insert({
        gp_id: gp.id,
        plan_id: null,
        document_type: "gp_press_release",
        source_url: art.url,
        content_hash: hash,
        content_text: art.text,
        storage_path: null,
        meeting_date: meetingDate,
        published_at: art.publishedAt,
        processing_status: "pending",
      });
      if (insErr) throw insErr;

      result.kept += 1;
      result.inserted.push(art);
    } catch (err) {
      result.errors.push({
        url,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
