/**
 * Blackstone press-release scraper.
 *
 * Target: https://www.blackstone.com/news/press/
 * The index page is server-rendered HTML (the /wp-json/ REST API is gated
 * behind a JS-challenge bot check, but we don't need it). Article URLs on
 * the index match the pattern `/news/press/<slug>/`. Each article page has:
 *   - <title>…</title> for the headline (with " - Blackstone" suffix to strip)
 *   - <meta property="article:published_time"> or article:modified_time for date
 *   - <div class="bx-article-content__content"> for the main body text
 */

import type { GpScraperConfig } from "./gp-press-release";
import { cleanText } from "./gp-press-release";

const INDEX_URL = "https://www.blackstone.com/news/press/";

export const blackstoneConfig: GpScraperConfig = {
  gpName: "Blackstone",
  indexUrl: INDEX_URL,

  discoverFromIndex(html) {
    const matches =
      html.match(
        /https:\/\/www\.blackstone\.com\/news\/press\/[a-z0-9][a-z0-9-]+\//g,
      ) ?? [];
    return Array.from(new Set(matches)).filter(
      (u) => !u.endsWith("/feed/") && !/\/page\/\d*\/?$/.test(u) && u !== INDEX_URL,
    );
  },

  extractArticle(_html, $, url) {
    const rawTitle = $("title").text() || "";
    const title = rawTitle
      .replace(/\s*[-|–]\s*Blackstone\s*$/i, "")
      .trim();

    const publishedAt =
      $('meta[property="article:published_time"]').attr("content") ||
      $('meta[property="article:modified_time"]').attr("content") ||
      null;

    // Primary selector seen on recent releases. Fall back to <article> if the
    // page template changes.
    let text = cleanText($(".bx-article-content__content").text());
    if (text.length < 200) {
      text = cleanText($("article").text());
    }

    return { url, title, publishedAt, text };
  },
};
