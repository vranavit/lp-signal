/**
 * Brookfield Asset Management press-release scraper.
 *
 * Index:      https://bam.brookfield.com/press-releases
 * Article:    /press-releases/{slug}
 * Each article page is static HTML (no SSR caveats) with:
 *   - <title> … " | Brookfield Asset Management (BAM)"
 *   - <meta property="article:published_time" content="YYYY-MM-DDTHH:MM:SSZ">
 *     (plus itemprop datePublished as backup)
 *   - <div class="news-wraper__body …"> for the body prose
 */

import type { GpScraperConfig } from "./gp-press-release";
import { cleanText } from "./gp-press-release";

const INDEX_URL = "https://bam.brookfield.com/press-releases";
const ARTICLE_HREF_RE =
  /\/press-releases\/[a-z0-9][a-z0-9-]+(?=\s|"|$)/g;

export const brookfieldConfig: GpScraperConfig = {
  gpName: "Brookfield",
  indexUrl: INDEX_URL,

  discoverFromIndex(html) {
    const set = new Set<string>();
    for (const m of html.matchAll(ARTICLE_HREF_RE)) {
      const path = m[0].trim();
      // Skip the index page itself, PDF rendered copies live under
      // /generation/pdf/document-file.pdf?path=/press-releases/... — those
      // get filtered by the regex's leading slash-press-releases-slug shape
      // already; explicit guard for safety:
      if (path === "/press-releases") continue;
      set.add(`https://bam.brookfield.com${path}`);
    }
    return Array.from(set);
  },

  extractArticle(_html, $, url) {
    const rawTitle = $("title").text() || "";
    const title = rawTitle
      .replace(/\s*\|\s*Brookfield Asset Management\s*\(BAM\)\s*$/i, "")
      .replace(/\s*\|\s*Brookfield Asset Management\s*$/i, "")
      .trim();

    const publishedAt =
      $('meta[property="article:published_time"]').attr("content") ||
      $('meta[itemprop="datePublished"]').attr("content") ||
      $('meta[name="datePublished"]').attr("content") ||
      null;

    // Primary container is `.news-wraper__body` (BAM's spelling; yes,
    // "wraper" with one 'p'). Falls back to `article` if the CMS template
    // renames the class.
    let text = cleanText($(".news-wraper__body").text());
    if (text.length < 200) text = cleanText($("article").text());
    if (text.length < 200) text = cleanText($("main").text());

    return { url, title, publishedAt, text };
  },
};
