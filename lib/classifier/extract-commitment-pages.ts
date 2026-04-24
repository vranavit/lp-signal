import { extractText, getDocumentProxy } from "unpdf";

/**
 * Keyword-based page extractor for LACERA-style agenda packets.
 *
 * LACERA BOI books run 400-750 pages; the ~5-10 pages that contain
 * actual commitment votes are buried between performance analytics and
 * manager presentation decks. Feeding the full book to the classifier
 * wastes the 300-page cap (it's simply rejected) and burns tokens on
 * signal-free content even when it fits.
 *
 * Strategy: page-level text extract via pdfjs (through unpdf), score
 * each page by hitting a weighted keyword list, keep pages above a
 * score threshold plus one page of context on each side (commitment
 * discussions span a page boundary more often than not).
 */

// Strong phrases tightly correlated with commitment-vote content.
// Weight 2 per occurrence.
const STRONG_KEYWORDS: RegExp[] = [
  /\bmotion by\b/i,
  /\bseconded by\b/i,
  /\bunanimously approved\b/i,
  /\bmotion carried\b/i,
  /\bcommitment of \$/i,
  /\bcommitment up to\b/i,
  /\bupon motion\b/i,
  // LACERA BOI agenda action items start with "RECOMMENDATION:" or
  // "Recommends approval" in the body of a staff memo. Both are more
  // specific than a plain `recommend` stem so they live in the strong
  // tier.
  /\brecommendation:/i,
  /\brecommends approval\b/i,
];

// Lower-specificity signals — common in governance prose but still
// useful when a page has several of them together. Weight 1 per
// occurrence (capped to one hit per keyword per page so a single
// repeated word doesn't drown the signal).
const MEDIUM_KEYWORDS: RegExp[] = [
  /\bapprove\b/i,
  /\bcommitment\b/i,
  /\bnew investment\b/i,
  /\bfund investment\b/i,
  /\bvote\b/i,
  /\bresolution\b/i,
  // Widened set for LACERA agenda packets: the investment-memo action
  // items routinely combine `recommend` + `subject to [legal review |
  // final documentation]` + a specific dollar amount. Requiring three
  // of these together keeps the threshold selective enough that pure
  // performance-analytics pages don't get dragged in.
  /\brecommend(?:ation|s|ed)?\b/i,
  /\bsubject to\b/i,
  /\baction item\b/i,
  /\bboard adopted\b/i,
  /\bup to \$/i,
  /\bmillion\b/i,
  /\bbillion\b/i,
];

export const SCORE_THRESHOLD = 3;
// +/- this many pages of context around each scoring page. Commitment
// discussions frequently span 2-3 pages; 1 is a conservative default.
export const CONTEXT_RADIUS = 1;

export type ExtractCommitmentPagesResult = {
  // 1-indexed page numbers retained in extractedText, in ascending order.
  pages: number[];
  totalPages: number;
  // Concatenation of the retained pages, with a clear marker per page.
  // Empty string when `pages.length === 0`.
  extractedText: string;
  // Score per retained page, parallel to `pages`. Useful for logging and
  // post-hoc tuning without re-running extraction.
  pageScores: Array<{ page: number; score: number; matched: string[] }>;
};

/**
 * Extract pages likely to contain commitment-vote content from a PDF.
 * Does not throw on unextractable pages — they score 0 and drop out.
 */
export async function extractCommitmentPages(
  pdfBuffer: Uint8Array,
): Promise<ExtractCommitmentPagesResult> {
  const pdf = await getDocumentProxy(pdfBuffer);
  const totalPages = pdf.numPages;
  // unpdf's extractText returns text per page when mergePages is false.
  // It accepts the proxy directly to avoid re-parsing.
  const extracted = await extractText(pdf, { mergePages: false });
  const pagesText: string[] = Array.isArray(extracted.text)
    ? (extracted.text as string[])
    : [extracted.text as string];

  const pageScores: Array<{ page: number; score: number; matched: string[] }> = [];
  for (let i = 0; i < pagesText.length; i++) {
    const text = pagesText[i] ?? "";
    const matched: string[] = [];
    let score = 0;
    for (const re of STRONG_KEYWORDS) {
      if (re.test(text)) {
        score += 2;
        matched.push(re.source);
      }
    }
    for (const re of MEDIUM_KEYWORDS) {
      if (re.test(text)) {
        score += 1;
        matched.push(re.source);
      }
    }
    if (score > 0) {
      pageScores.push({ page: i + 1, score, matched });
    }
  }

  // Start with the set of pages that cleared the threshold, then expand
  // each by CONTEXT_RADIUS on either side. Context pages inherit their
  // neighbor's score logging under the `matched: ["<context>"]` label so
  // the extraction summary still accounts for every retained page.
  const keepSet = new Set<number>();
  for (const p of pageScores) {
    if (p.score < SCORE_THRESHOLD) continue;
    for (let d = -CONTEXT_RADIUS; d <= CONTEXT_RADIUS; d++) {
      const pageNum = p.page + d;
      if (pageNum >= 1 && pageNum <= totalPages) keepSet.add(pageNum);
    }
  }
  const retainedPages = [...keepSet].sort((a, b) => a - b);

  const retainedScores = retainedPages.map((page) => {
    const found = pageScores.find((s) => s.page === page);
    return {
      page,
      score: found?.score ?? 0,
      matched: found?.matched ?? ["<context>"],
    };
  });

  const extractedText = retainedPages
    .map((page) => {
      const raw = pagesText[page - 1] ?? "";
      // Collapse runs of whitespace so the prompt doesn't spend tokens
      // on unpdf's generous newline splits while keeping paragraph-ish
      // breaks.
      const cleaned = raw.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
      return `=== Page ${page} ===\n${cleaned}`;
    })
    .join("\n\n");

  return {
    pages: retainedPages,
    totalPages,
    extractedText,
    pageScores: retainedScores,
  };
}
