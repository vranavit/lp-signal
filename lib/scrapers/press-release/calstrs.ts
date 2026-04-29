import * as cheerio from "cheerio";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchText } from "../http";

/**
 * CalSTRS plan-side press release scraper. Single-level crawl off the
 * /news-releases index. Same architecture as the CalPERS press scraper:
 * server-rendered HTML, no JS execution, no Storage upload (HTML body
 * lives in documents.content_text).
 *
 * Verified 2026-04-30: fetchWithDefaults clears CalSTRS's WAF via the
 * existing Chrome 132 UA + sec-fetch-* headers in lib/scrapers/http.ts.
 * No special handling required.
 *
 * Index structure: each release is an <article class="poc-instance">
 * wrapping an <a class="inner" href="/{slug}">. The page-header article
 * (id="poc") has no inner anchor and is naturally excluded. CalSTRS also
 * renders sidebar CTAs (e.g. "sign up for email updates") with the same
 * .poc-instance / a.inner shape — neither class filters nor URL patterns
 * disambiguate them reliably. We let CTAs through discovery and rely on
 * the body-length floor at fetch time to drop them silently. Date is
 * embedded in body text as "(Month DD, YYYY)".
 *
 * Per-document dedup via content_hash uniqueness check against the
 * documents table. Source-level fingerprinting handled by runScrapeCron
 * at the cron-route layer.
 */

export const CALSTRS_PRESS_INDEX = "https://www.calstrs.com/news-releases";

const FETCH_DELAY_MS = 500;
const MIN_BODY_TEXT_LENGTH = 200;
// Matches "(December 8, 2025)" / "(July 30, 2025)" / "(May 13, 2025)" etc.
const DATE_RE = /\(([A-Z][a-z]+\s+\d{1,2},\s+\d{4})\)/;

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

export async function scrapeCalSTRSPressReleases(
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
      .eq("name", "CalSTRS")
      .maybeSingle();
    if (error || !plan) {
      throw new Error(
        `CalSTRS plan row not found: ${error?.message ?? "no row"}`,
      );
    }
    planId = plan.id;
  }

  const indexHtml = await fetchText(CALSTRS_PRESS_INDEX);
  const $ = cheerio.load(indexHtml);
  const seen = new Set<string>();
  const releases: DiscoveredRelease[] = [];

  $("article.poc-instance a.inner[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const abs = new URL(href, CALSTRS_PRESS_INDEX).toString();
    if (seen.has(abs)) return;
    seen.add(abs);

    const $art = $(el).closest("article");
    const articleText = $art.text().replace(/\s+/g, " ");
    const dateMatch = articleText.match(DATE_RE);
    const titleHint = $art
      .find("h3, h2")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();

    releases.push({
      url: abs,
      titleHint,
      dateHint: dateMatch ? dateMatch[1] : null,
    });
  });

  result.releasesFound = releases.length;

  if (releases.length === 0) {
    throw new Error(
      "CalSTRS press release scraper: 0 release links discovered. The " +
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
        // CalSTRS sidebar CTAs (e.g. "sign up for email updates") share
        // the .poc-instance / a.inner shape with real releases. Skip them
        // silently rather than logging an error — the cron-health flag
        // should be reserved for real failures.
        continue;
      }

      let publishedAt: string | null = null;
      const datetimeAttr = $a("time[datetime]").attr("datetime");
      if (datetimeAttr) {
        const d = new Date(datetimeAttr);
        if (!Number.isNaN(d.getTime())) publishedAt = d.toISOString();
      }
      if (!publishedAt) {
        const candidate = r.dateHint ?? text.match(DATE_RE)?.[1] ?? null;
        if (candidate) {
          const d = new Date(candidate);
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
