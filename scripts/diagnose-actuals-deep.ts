/**
 * Phase 1 deep probe — follow up to scripts/diagnose-actuals-gap.ts.
 *
 * Goal: for each of the 6 plans, print the FULL text of the top 3 candidate
 * pages (not truncated to 1500 chars) PLUS any pages whose text contains
 * common "actuals" indicators that the first probe didn't surface:
 *
 *   - "Schedule of Investments"
 *   - "Asset Summary" / "Investment Summary"
 *   - "Fair Value of Investments"
 *   - "% of Net Position"
 *   - "% of Total" / "% of Plan Net Position"
 *   - "$ in (millions|thousands|billions)"
 *
 * If actuals are anywhere in the document, these phrases catch them.
 *
 * Read-only. No DB writes.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { extractText, getDocumentProxy } from "unpdf";

type Target = {
  label: string;
  planMatch: { column: "name" | "scrape_config->>key"; value: string };
};

const TARGETS: Target[] = [
  {
    label: "NYSCRF",
    planMatch: { column: "name", value: "New York State Common Retirement Fund" },
  },
  { label: "WSIB", planMatch: { column: "name", value: "Washington State Investment Board" } },
  { label: "Wisconsin SWIB", planMatch: { column: "name", value: "Wisconsin SWIB" } },
  { label: "NCRS", planMatch: { column: "scrape_config->>key", value: "nc_retirement" } },
  { label: "Ohio PERS", planMatch: { column: "scrape_config->>key", value: "ohio_pers" } },
  { label: "PA PSERS", planMatch: { column: "scrape_config->>key", value: "pa_psers" } },
];

const ACTUALS_INDICATORS: Array<{ name: string; re: RegExp }> = [
  { name: "schedule_of_investments", re: /\bschedule\s+of\s+investments\b/i },
  { name: "asset_summary", re: /\basset\s+summary\b/i },
  { name: "investment_summary", re: /\binvestment\s+summary\b/i },
  { name: "fair_value_of_investments", re: /\bfair\s+value\s+of\s+investments\b/i },
  { name: "pct_of_net_position", re: /%\s*of\s+(net\s+position|total\s+net|plan\s+net|fair\s+value)/i },
  { name: "actual_allocation_phrase", re: /\bactual\s+(allocation|asset\s+allocation|weight|%|percent)/i },
  { name: "current_allocation_phrase", re: /\bcurrent\s+(allocation|weight|%)/i },
  { name: "target_vs_actual_table", re: /\btarget\b.{0,60}\bactual\b/is },
  { name: "asset_mix_at_year_end", re: /\b(asset\s+mix|portfolio\s+composition)\b/i },
];

async function fetchPdf(url: string): Promise<Uint8Array> {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Accept: "application/pdf,*/*",
    },
  });
  if (!r.ok) throw new Error(`fetch ${url} → ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

async function probe(target: Target) {
  console.log(`\n${"#".repeat(80)}\n# ${target.label}\n${"#".repeat(80)}`);
  const supabase = createSupabaseAdminClient();
  const planQuery = supabase.from("plans").select("id, name").limit(1);
  const { data: plan } = await (target.planMatch.column === "name"
    ? planQuery.eq("name", target.planMatch.value)
    : planQuery.eq("scrape_config->>key", target.planMatch.value)
  ).single();
  if (!plan) {
    console.log(`  plan not found`);
    return;
  }
  const { data: allocs } = await supabase
    .from("pension_allocations")
    .select("source_document_id")
    .eq("plan_id", plan.id);
  const sourceId = (allocs ?? []).map((a) => a.source_document_id).filter(Boolean)[0];
  if (!sourceId) {
    console.log(`  no source doc`);
    return;
  }
  const { data: doc } = await supabase
    .from("documents")
    .select("source_url")
    .eq("id", sourceId)
    .single();
  const url = doc?.source_url;
  if (!url) {
    console.log(`  no url`);
    return;
  }

  const bytes = await fetchPdf(url);
  const pdf = await getDocumentProxy(bytes);
  const ex = await extractText(pdf, { mergePages: false });
  const pages: string[] = Array.isArray(ex.text) ? (ex.text as string[]) : [ex.text as string];
  console.log(`  parsed ${pages.length} pages from ${url}`);

  // Find indicator hits.
  const hits: Array<{ page: number; indicator: string; snippet: string }> = [];
  for (let i = 0; i < pages.length; i++) {
    const text = pages[i] ?? "";
    for (const ind of ACTUALS_INDICATORS) {
      if (ind.re.test(text)) {
        const m = text.match(ind.re);
        const idx = m?.index ?? 0;
        const start = Math.max(0, idx - 60);
        const end = Math.min(text.length, idx + 200);
        hits.push({
          page: i + 1,
          indicator: ind.name,
          snippet: text.slice(start, end).replace(/\s+/g, " ").trim(),
        });
      }
    }
  }
  console.log(`\n  ── ACTUALS-INDICATOR hits (${hits.length}) ──`);
  for (const h of hits.slice(0, 30)) {
    console.log(`    p.${h.page} [${h.indicator}] …${h.snippet}…`);
  }

  // Find the page that yielded the highest target-table score in round 1
  // and print the full text +/- 1 page.
  // Easier: for each plan, do a fresh score and print pages with score>=8.
  const scores: Array<{ page: number; score: number }> = [];
  const TABLE_KW: RegExp[] = [
    /\btarget\s+(asset\s+)?allocation\b/i,
    /\bpolicy\s+target\b/i,
    /\bpolicy\s+range\b/i,
    /\basset\s+allocation\b.*\b(actual|current|target)/i,
  ];
  for (let i = 0; i < pages.length; i++) {
    const t = pages[i] ?? "";
    let s = 0;
    for (const re of TABLE_KW) if (re.test(t)) s += 3;
    if (/\bprivate\s+equity\b/i.test(t)) s += 1;
    if (/\bfixed\s+income\b/i.test(t)) s += 1;
    if (/\bpublic\s+equity\b/i.test(t)) s += 1;
    if (/\breal\s+estate\b/i.test(t)) s += 1;
    if (s > 0) scores.push({ page: i + 1, score: s });
  }
  scores.sort((a, b) => b.score - a.score);
  const topPages = scores.slice(0, 4).map((s) => s.page);
  const fullDump = new Set<number>();
  for (const p of topPages) {
    fullDump.add(p);
    if (p > 1) fullDump.add(p - 1);
    if (p < pages.length) fullDump.add(p + 1);
  }
  const dumpList = Array.from(fullDump).sort((a, b) => a - b);
  console.log(`\n  ── FULL TEXT of top candidate pages: ${dumpList.join(", ")} ──`);
  for (const p of dumpList) {
    const t = (pages[p - 1] ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    console.log(`\n  ▸▸▸ page ${p} (${t.length} chars) ▸▸▸`);
    console.log(t);
  }
}

async function main() {
  const which = process.argv[2];
  for (const t of TARGETS) {
    if (which && t.label.toLowerCase() !== which.toLowerCase()) continue;
    try {
      await probe(t);
    } catch (e) {
      console.log(`✖ ${t.label}: ${(e as Error).message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
