/**
 * Phase 1 third-pass probe — print arbitrary specific pages from each plan's
 * source PDF. Used when round-2 didn't dump the right pages.
 *
 * Usage: pnpm tsx scripts/diagnose-actuals-pages.ts <plan> <page1>,<page2>,...
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { extractText, getDocumentProxy } from "unpdf";

const PLAN_LOOKUP: Record<string, { column: "name" | "scrape_config->>key"; value: string }> = {
  nyscrf: { column: "name", value: "New York State Common Retirement Fund" },
  wsib: { column: "name", value: "Washington State Investment Board" },
  swib: { column: "name", value: "Wisconsin SWIB" },
  ncrs: { column: "scrape_config->>key", value: "nc_retirement" },
  ohio: { column: "scrape_config->>key", value: "ohio_pers" },
  psers: { column: "scrape_config->>key", value: "pa_psers" },
};

async function fetchPdf(url: string): Promise<Uint8Array> {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/pdf,*/*",
    },
  });
  if (!r.ok) throw new Error(`fetch → ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

async function main() {
  const planKey = process.argv[2];
  const pages = (process.argv[3] ?? "").split(",").map((s) => parseInt(s.trim(), 10)).filter(Boolean);
  if (!planKey || pages.length === 0) {
    console.log("usage: tsx diagnose-actuals-pages.ts <nyscrf|wsib|swib|ncrs|ohio|psers> <page1>,<page2>,...");
    process.exit(1);
  }
  const lookup = PLAN_LOOKUP[planKey];
  if (!lookup) {
    console.log(`unknown plan key: ${planKey}`);
    process.exit(1);
  }
  const supabase = createSupabaseAdminClient();
  const q = supabase.from("plans").select("id").limit(1);
  const { data: plan } = await (lookup.column === "name"
    ? q.eq("name", lookup.value)
    : q.eq("scrape_config->>key", lookup.value)
  ).single();
  if (!plan) {
    console.log("plan not found");
    process.exit(1);
  }
  const { data: allocs } = await supabase
    .from("pension_allocations")
    .select("source_document_id")
    .eq("plan_id", plan.id);
  const sourceId = (allocs ?? []).map((a) => a.source_document_id).filter(Boolean)[0];
  const { data: doc } = await supabase
    .from("documents")
    .select("source_url")
    .eq("id", sourceId as string)
    .single();
  if (!doc?.source_url) {
    console.log("no source url");
    process.exit(1);
  }
  console.log(`plan=${planKey} url=${doc.source_url}`);
  const bytes = await fetchPdf(doc.source_url);
  const pdf = await getDocumentProxy(bytes);
  const ex = await extractText(pdf, { mergePages: false });
  const all: string[] = Array.isArray(ex.text) ? (ex.text as string[]) : [ex.text as string];
  for (const p of pages) {
    const t = (all[p - 1] ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    console.log(`\n${"=".repeat(80)}\nPAGE ${p} (${t.length} chars)\n${"=".repeat(80)}`);
    console.log(t);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
