/**
 * Phase 1 alternative-source probe — fetch candidate alt URLs (not yet
 * ingested) and quickly check whether they contain target+actual tables.
 */

import { extractText, getDocumentProxy } from "unpdf";

const CANDIDATES: Array<{ label: string; url: string }> = [
  {
    label: "NYSCRF — NYSLRS ACFR 2025 (dedicated retirement CAFR)",
    url: "https://www.osc.ny.gov/files/retirement/resources/pdf/annual-comprehensive-financial-report-2025.pdf",
  },
  {
    label: "WSIB — quarterly investment report Q2 2025",
    url: "https://www.sib.wa.gov/docs/reports/quarterly/qr063025.pdf",
  },
  {
    label: "NCRS — Quarterly Investment Report Q3 2025",
    url: "https://www.nctreasurer.gov/documents/files/imdiac/quarterly-investment-report-qir-2025q3/open",
  },
  {
    label: "NCRS — Quarterly Investment Report Q1 2025",
    url: "https://www.nctreasurer.gov/documents/files/imdinvestmentreports/quarterly-investment-report-qir-2025q1/open",
  },
];

async function fetchPdf(url: string): Promise<Uint8Array> {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Accept: "application/pdf,*/*",
    },
    redirect: "follow",
  });
  if (!r.ok) throw new Error(`fetch → ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

const ACTUAL_INDICATORS: Array<{ name: string; re: RegExp }> = [
  { name: "actual_allocation", re: /\bactual\s+(allocation|asset\s+allocation|weight|%)/i },
  { name: "current_allocation", re: /\bcurrent\s+(allocation|weight)/i },
  { name: "target_vs_actual", re: /target\b.{0,80}\bactual\b/is },
  { name: "policy_target_vs_actual", re: /policy.{0,60}actual/is },
  { name: "as_of_actual", re: /as\s+of.{0,40}actual/is },
  { name: "actual_pct_column", re: /\bactual\s*%/i },
  { name: "comparison_actual", re: /comparison.{0,80}actual/is },
];

async function probe({ label, url }: { label: string; url: string }) {
  console.log(`\n${"=".repeat(80)}\n${label}\n${url}\n${"=".repeat(80)}`);
  let bytes: Uint8Array;
  try {
    bytes = await fetchPdf(url);
    console.log(`  fetched ${(bytes.length / 1024 / 1024).toFixed(2)} MB`);
  } catch (e) {
    console.log(`  ✖ ${(e as Error).message}`);
    return;
  }
  let pages: string[];
  try {
    const pdf = await getDocumentProxy(bytes);
    const ex = await extractText(pdf, { mergePages: false });
    pages = Array.isArray(ex.text) ? (ex.text as string[]) : [ex.text as string];
    console.log(`  parsed ${pages.length} pages`);
  } catch (e) {
    console.log(`  ✖ unpdf parse failed: ${(e as Error).message}`);
    return;
  }

  // Find indicator hits.
  const hits: Array<{ page: number; indicator: string; snippet: string }> = [];
  for (let i = 0; i < pages.length; i++) {
    const t = pages[i] ?? "";
    for (const ind of ACTUAL_INDICATORS) {
      const m = t.match(ind.re);
      if (m) {
        const idx = m.index ?? 0;
        const start = Math.max(0, idx - 40);
        const end = Math.min(t.length, idx + 240);
        hits.push({
          page: i + 1,
          indicator: ind.name,
          snippet: t.slice(start, end).replace(/\s+/g, " ").trim(),
        });
      }
    }
  }
  console.log(`\n  ── ACTUAL-INDICATOR hits (${hits.length}) ──`);
  for (const h of hits.slice(0, 12)) {
    console.log(`    p.${h.page} [${h.indicator}] …${h.snippet}…`);
  }
  // Print full text of the page with the most hits.
  const byPage = new Map<number, number>();
  for (const h of hits) byPage.set(h.page, (byPage.get(h.page) ?? 0) + 1);
  const top = Array.from(byPage.entries()).sort((a, b) => b[1] - a[1]).slice(0, 2);
  for (const [page, count] of top) {
    console.log(`\n  ── page ${page} (${count} hits) full text ──`);
    const t = (pages[page - 1] ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    console.log(t.slice(0, 2400));
  }
}

async function main() {
  for (const c of CANDIDATES) {
    try {
      await probe(c);
    } catch (e) {
      console.log(`crash on ${c.label}: ${(e as Error).message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
