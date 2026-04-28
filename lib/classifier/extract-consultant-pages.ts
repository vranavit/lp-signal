import { extractText, getDocumentProxy } from "unpdf";

/**
 * Keyword-based page extractor for CAFR consultant fee schedules.
 *
 * CAFRs run 150-300 pages; the consultant fee schedule lives in 1-3
 * pages buried in the Notes to Financial Statements or the Investment
 * Section. Feeding the full document to the classifier wastes tokens
 * and introduces noise from the hundreds of asset-management line
 * items that are NOT consultant entries.
 *
 * Strategy: page-level text via unpdf, score each page by hitting a
 * weighted keyword list, retain pages above threshold + 1 page of
 * context each side. Companion to extract-commitment-pages.ts (same
 * shape, different keyword domain).
 *
 * Workstream 2 Phase A.
 */

// Strong phrases tightly correlated with consultant fee schedules.
// Weight 2 per occurrence.
const STRONG_KEYWORDS: RegExp[] = [
  /\binvestment\s+consultant/i,
  /\bgeneral\s+consultant/i,
  /\bspecialty\s+consultant/i,
  /\breal\s+estate\s+consultant/i,
  /\bprivate\s+equity\s+consultant/i,
  /\binfrastructure\s+consultant/i,
  /\bhedge\s+fund\s+consultant/i,
  /\babsolute\s+return\s+consultant/i,
  /\bboard\s+consultant/i,
  /\bconsulting\s+services/i,
  /\bschedule\s+of\s+investment\s+fees/i,
  /\bschedule\s+of\s+professional\s+services/i,
];

// Lower-specificity signals - common in CAFR fee tables but also in
// non-consultant sections. Weight 1 per occurrence.
const MEDIUM_KEYWORDS: RegExp[] = [
  /\badvisory\s+fees/i,
  /\bprofessional\s+services/i,
  /\bconsulting\s+fees/i,
  /\binvestment\s+management\s+fees/i,
  /\bschedule\s+of\s+fees/i,
  // Master-list firm names. A page mentioning these alongside any
  // fee context is almost certainly the consultant schedule. Hardcoded
  // here rather than passed in at runtime - keeps the extractor pure
  // and fast (master list rarely changes).
  /\bAksia\b/i,
  /\bAlbourne\b/i,
  /\bCambridge\s+Associates\b/i,
  /\bCallan\b/i,
  /\bCliffwater\b/i,
  /\bHamilton\s+Lane\b/i,
  /\bMeketa\b/i,
  /\bNEPC\b/i,
  /\bRVK\b/i,
  /\bStepStone\b/i,
  /\bTownsend\b/i,
  /\bVerus\b/i,
  /\bWilshire\b/i,
];

export const SCORE_THRESHOLD = 2;
// +/- this many pages of context around each scoring page. Consultant
// schedules occasionally span page boundaries (firm list continues on
// the next page); 1 is a conservative default that covers continuations.
export const CONTEXT_RADIUS = 1;

export type ExtractConsultantPagesResult = {
  // 1-indexed page numbers retained, in ascending order.
  pages: number[];
  totalPages: number;
  // Concatenation of retained pages with "=== Page N ===" markers.
  // Empty string when pages.length === 0.
  extractedText: string;
  // Score per retained page, parallel to `pages`. Useful for logging
  // and post-hoc tuning without re-running extraction.
  pageScores: Array<{ page: number; score: number; matched: string[] }>;
};

async function readPagesTextWithUnpdf(
  pdfBuffer: Uint8Array,
): Promise<{ totalPages: number; pagesText: string[] }> {
  const pdf = await getDocumentProxy(pdfBuffer);
  const totalPages = pdf.numPages;
  const extracted = await extractText(pdf, { mergePages: false });
  const pagesText: string[] = Array.isArray(extracted.text)
    ? (extracted.text as string[])
    : [extracted.text as string];
  return { totalPages, pagesText };
}

function renderExcerpt(pagesText: string[], retainedPages: number[]): string {
  return retainedPages
    .map((page) => {
      const raw = pagesText[page - 1] ?? "";
      const cleaned = raw.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
      return `=== Page ${page} ===\n${cleaned}`;
    })
    .join("\n\n");
}

/**
 * Extract pages likely to contain consultant fee schedules from a CAFR.
 * Returns retained pages, total pages, and the rendered excerpt with
 * "=== Page N ===" markers ready to feed extractConsultantsFromText.
 */
export async function extractConsultantPages(
  pdfBuffer: Uint8Array,
): Promise<ExtractConsultantPagesResult> {
  const { totalPages, pagesText } = await readPagesTextWithUnpdf(pdfBuffer);

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

  return {
    pages: retainedPages,
    totalPages,
    extractedText: renderExcerpt(pagesText, retainedPages),
    pageScores: retainedScores,
  };
}
