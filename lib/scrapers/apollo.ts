/**
 * Apollo press-release scraper.
 *
 * Index: https://www.apollo.com/insights-news/pressreleases
 * Article URL pattern: /insights-news/pressreleases/{YYYY}/{MM}/{slug}-{id}
 *
 * The page is static HTML with real article hrefs inline on the index and
 * full prose on each article page. Body paragraphs are wrapped in
 * `<p class="cmp-text cmp-apollo-text ...">`. No `article:published_time`
 * meta — we fall back to parsing YYYY/MM from the URL path for publishedAt
 * (day is often only present in prose, and the classifier extracts its own
 * approval_date from the body anyway).
 */

import type { GpScraperConfig } from "./gp-press-release";
import { cleanText } from "./gp-press-release";

const INDEX_URL = "https://www.apollo.com/insights-news/pressreleases";
const ARTICLE_URL_RE =
  /https:\/\/www\.apollo\.com\/insights-news\/pressreleases\/\d{4}\/\d{2}\/[a-z0-9][a-z0-9-]+/g;
const ARTICLE_PATH_RE =
  /\/insights-news\/pressreleases\/\d{4}\/\d{2}\/[a-z0-9][a-z0-9-]+/g;
const URL_DATE_RE =
  /\/insights-news\/pressreleases\/(\d{4})\/(\d{2})\//;

export const apolloConfig: GpScraperConfig = {
  gpName: "Apollo",
  indexUrl: INDEX_URL,

  discoverFromIndex(html) {
    const absolute = html.match(ARTICLE_URL_RE) ?? [];
    const relative = (html.match(ARTICLE_PATH_RE) ?? []).map(
      (p) => `https://www.apollo.com${p}`,
    );
    return Array.from(new Set([...absolute, ...relative]));
  },

  extractArticle(_html, $, url) {
    const rawTitle = $("title").text() || "";
    // Apollo title ends with "Apollo Global Management" (no separator). Strip it.
    const title = rawTitle
      .replace(/Apollo Global Management\s*$/i, "")
      .trim();

    const m = url.match(URL_DATE_RE);
    const publishedAt = m ? `${m[1]}-${m[2]}-01T00:00:00Z` : null;

    // Body paragraphs live under .cmp-text / .cmp-apollo-text. Concatenate.
    let text = cleanText(
      $("p.cmp-text, p.cmp-apollo-text").map((_, el) => $(el).text()).get().join("\n"),
    );
    if (text.length < 200) {
      text = cleanText($("article").text());
    }
    if (text.length < 200) {
      text = cleanText($("main").text());
    }

    return { url, title, publishedAt, text };
  },
};
