/**
 * Audit utility: scan an ACFR PDF for all mentions of a target firm with
 * ~200 chars of surrounding context per hit. Used during fee-verification
 * audits to confirm whether a captured plan_consultants.fee_usd reflects
 * the firm's full ACFR-disclosed retainer or only a partial slice from
 * one schedule among multiple.
 *
 * Methodology: extract page-level text via unpdf (the same library the
 * ingestion pipeline uses), then run a case-insensitive regex over every
 * page. Hits within ~50 chars of each other on the same page are deduped
 * so a single line item only surfaces once.
 *
 * Usage:
 *   pnpm tsx scripts/audit-acfr-firm-scan.ts <pdf-path> <regex>
 * Example:
 *   pnpm tsx scripts/audit-acfr-firm-scan.ts /tmp/acfr-audit/nystrs.pdf "Meketa"
 *
 * Used in:
 *   - Audit 1 Phase 2 P2.1 + P2.2 fee re-validation
 *     (CalSTRS RVK + NYSTRS Meketa, 2026-04-28)
 *   - Reusable for future fee-verification work and the LACERA P2.6
 *     re-extraction.
 */
import fs from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";

async function main() {
  const [, , pdfPath, pattern] = process.argv;
  if (!pdfPath || !pattern) {
    console.error("usage: _tmp-acfr-firm-scan.ts <pdf-path> <regex>");
    process.exit(2);
  }
  const buf = new Uint8Array(fs.readFileSync(pdfPath));
  const pdf = await getDocumentProxy(buf);
  const totalPages = pdf.numPages;
  const extracted = await extractText(pdf, { mergePages: false });
  const pages: string[] = Array.isArray(extracted.text)
    ? (extracted.text as string[])
    : [extracted.text as string];

  const re = new RegExp(pattern, "gi");
  let totalHits = 0;
  for (let i = 0; i < pages.length; i++) {
    const text = pages[i] ?? "";
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    const seenForPage = new Set<number>();
    while ((m = re.exec(text)) !== null) {
      const start = Math.max(0, m.index - 120);
      const end = Math.min(text.length, m.index + m[0].length + 200);
      // Dedupe overlapping hits on the same page (within ~50 chars)
      let dup = false;
      for (const s of seenForPage) {
        if (Math.abs(s - m.index) < 50) {
          dup = true;
          break;
        }
      }
      if (dup) continue;
      seenForPage.add(m.index);
      const ctx = text.slice(start, end).replace(/\s+/g, " ").trim();
      console.log(`PAGE ${i + 1}: ...${ctx}...`);
      totalHits++;
    }
  }
  console.log(`---\ntotal pages: ${totalPages}, total hits: ${totalHits}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
