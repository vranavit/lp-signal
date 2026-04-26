/**
 * Phase 1 diagnostic for the "0 actual_pct" sprint.
 *
 * For each of the 6 plans missing actuals, this script:
 *   a) Queries documents + pension_allocations for the source we ingested.
 *   b) Downloads the source PDF and extracts page-level text via unpdf.
 *   c) Scores pages on allocation-table keywords and prints sample text
 *      from the top candidate pages. Used to manually judge whether
 *      actuals are present in the existing source.
 *
 * Read-only. No DB writes. Output is the deliverable.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { extractText, getDocumentProxy } from "unpdf";

type Target = {
  planMatch: { column: "name" | "scrape_config->>key"; value: string };
  label: string;
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

// Allocation-table keyword set. Strong = phrase that almost always appears
// in the table itself; medium = column / row labels.
const STRONG = [
  /\btarget\s+(asset\s+)?allocation\b/i,
  /\binvestment\s+policy\s+(statement|target)/i,
  /\bpolicy\s+target\b/i,
  /\bpolicy\s+benchmark\b/i,
  /\bactual\s+allocation\b/i,
  /\basset\s+allocation\b.*\b(actual|current|target)/i,
  /\btarget\s*%/i,
  /\bactual\s*%/i,
  /\bpolicy\s+range\b/i,
];

const MEDIUM = [
  /\btarget\b/i,
  /\bactual\b/i,
  /\bcurrent\s+(allocation|weight)/i,
  /\basset\s+class\b/i,
  /\bprivate\s+equity\b/i,
  /\bfixed\s+income\b/i,
  /\bpublic\s+equity\b/i,
  /\breal\s+estate\b/i,
  /\binfrastructure\b/i,
  /\bcredit\b/i,
];

type PageScore = { page: number; score: number; matched: string[]; len: number };

function scorePages(pagesText: string[]): PageScore[] {
  return pagesText.map((t, i) => {
    const text = t ?? "";
    const matched: string[] = [];
    let score = 0;
    for (const re of STRONG) {
      if (re.test(text)) {
        score += 3;
        matched.push(re.source);
      }
    }
    for (const re of MEDIUM) {
      if (re.test(text)) {
        score += 1;
        matched.push(re.source);
      }
    }
    return { page: i + 1, score, matched, len: text.length };
  });
}

function snippet(text: string, max: number = 1200): string {
  const cleaned = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return cleaned.length > max ? cleaned.slice(0, max) + "…" : cleaned;
}

// Heuristic: a page that mentions "target" alongside "actual" or "current"
// in the same paragraph is a strong actual-pct candidate.
function hasActualsSignal(text: string): { found: boolean; reason: string } {
  const t = text.toLowerCase();
  if (/\bactual\s*%/i.test(text)) return { found: true, reason: "actual %" };
  if (/\bcurrent\s*allocation/i.test(text) && /\btarget/i.test(t))
    return { found: true, reason: "current allocation + target" };
  if (/\bactual\b/.test(t) && /\btarget\b/.test(t) && /\b(equity|fixed income|private)\b/.test(t))
    return { found: true, reason: "actual + target + asset class label" };
  // CAFRs often label the actuals column "FY end %" or "as of {date}".
  if (/\bas\s+of\b/i.test(text) && /\btarget\b/i.test(t) && /%/.test(text))
    return { found: true, reason: "as of + target + %" };
  return { found: false, reason: "" };
}

async function fetchPdf(url: string): Promise<Uint8Array> {
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Accept: "application/pdf,*/*",
    },
  });
  if (!r.ok) throw new Error(`fetch ${url} → ${r.status}`);
  const buf = await r.arrayBuffer();
  return new Uint8Array(buf);
}

async function diagnose(target: Target) {
  const supabase = createSupabaseAdminClient();
  console.log(`\n${"=".repeat(80)}\n${target.label}\n${"=".repeat(80)}`);

  const planQuery = supabase.from("plans").select("id, name, scrape_config").limit(1);
  const { data: planRow, error: planErr } = await (target.planMatch.column === "name"
    ? planQuery.eq("name", target.planMatch.value)
    : planQuery.eq("scrape_config->>key", target.planMatch.value)
  ).single();
  if (planErr || !planRow) {
    console.log(`  ✖ plan not found: ${planErr?.message}`);
    return;
  }
  console.log(`  plan_id: ${planRow.id} · ${planRow.name}`);

  const { data: allocs, error: allocErr } = await supabase
    .from("pension_allocations")
    .select(
      "id, asset_class, sub_class, target_pct, target_min_pct, target_max_pct, actual_pct, actual_usd, as_of_date, confidence, source_document_id",
    )
    .eq("plan_id", planRow.id)
    .order("as_of_date", { ascending: false });
  if (allocErr) {
    console.log(`  ✖ allocations query: ${allocErr.message}`);
    return;
  }
  console.log(`  pension_allocations rows: ${allocs?.length ?? 0}`);
  for (const a of allocs ?? []) {
    const sc = a.sub_class ? ` · ${a.sub_class}` : "";
    console.log(
      `    ${a.as_of_date} · ${a.asset_class}${sc} · target=${a.target_pct}% range=[${a.target_min_pct ?? "—"},${a.target_max_pct ?? "—"}] actual=${a.actual_pct ?? "—"}% conf=${a.confidence}`,
    );
  }
  const sourceIds = Array.from(
    new Set((allocs ?? []).map((a) => a.source_document_id).filter(Boolean) as string[]),
  );
  console.log(`  unique source documents referenced: ${sourceIds.length}`);

  if (sourceIds.length === 0) {
    console.log(`  ✖ no source_document_id on any allocation — cannot probe`);
    return;
  }

  const { data: docs, error: docErr } = await supabase
    .from("documents")
    .select("id, document_type, source_url, meeting_date, processing_status, storage_path, created_at")
    .in("id", sourceIds);
  if (docErr) {
    console.log(`  ✖ documents query: ${docErr.message}`);
    return;
  }
  for (const d of docs ?? []) {
    console.log(
      `  doc ${d.id}\n    type=${d.document_type} fye=${d.meeting_date} status=${d.processing_status}\n    url=${d.source_url}\n    storage_path=${d.storage_path ?? "(null — files-api or oversized)"}`,
    );
  }

  // Probe the first source URL.
  const url = (docs?.[0] ?? null)?.source_url;
  if (!url) {
    console.log(`  ✖ no source_url on doc — skipping PDF probe`);
    return;
  }
  console.log(`\n  probing PDF: ${url}`);
  let bytes: Uint8Array;
  try {
    bytes = await fetchPdf(url);
    console.log(`  fetched ${(bytes.length / 1024 / 1024).toFixed(2)} MB`);
  } catch (e) {
    console.log(`  ✖ fetch failed: ${(e as Error).message}`);
    return;
  }

  let pagesText: string[];
  let totalPages: number;
  try {
    const pdf = await getDocumentProxy(bytes);
    totalPages = pdf.numPages;
    const ex = await extractText(pdf, { mergePages: false });
    pagesText = Array.isArray(ex.text) ? (ex.text as string[]) : [ex.text as string];
    console.log(`  parsed ${totalPages} pages`);
  } catch (e) {
    console.log(`  ✖ unpdf parse failed: ${(e as Error).message}`);
    return;
  }

  const scores = scorePages(pagesText).filter((s) => s.score > 0);
  scores.sort((a, b) => b.score - a.score);
  const top = scores.slice(0, 6);
  console.log(`  pages with allocation-keyword hits: ${scores.length}`);
  console.log(`  top ${top.length} candidate pages:`);
  for (const s of top) {
    console.log(`    p.${s.page} score=${s.score} len=${s.len} matched=[${s.matched.slice(0, 6).join(", ")}]`);
  }

  // Check whether ANY page exhibits the actuals-signal heuristic.
  const actualPages: Array<{ page: number; reason: string }> = [];
  for (const s of top) {
    const txt = pagesText[s.page - 1] ?? "";
    const sig = hasActualsSignal(txt);
    if (sig.found) actualPages.push({ page: s.page, reason: sig.reason });
  }
  if (actualPages.length === 0) {
    console.log(`  HEURISTIC: NO actuals signal found on top candidate pages`);
  } else {
    console.log(
      `  HEURISTIC: actuals signal candidates → ${actualPages.map((p) => `p.${p.page}(${p.reason})`).join(", ")}`,
    );
  }

  // Print sample from top 2 pages so we can eyeball the table format.
  for (const s of top.slice(0, 2)) {
    const txt = pagesText[s.page - 1] ?? "";
    console.log(`\n  ── page ${s.page} sample ──`);
    console.log(snippet(txt, 1500));
  }
}

async function main() {
  for (const t of TARGETS) {
    try {
      await diagnose(t);
    } catch (e) {
      console.log(`\n✖ ${t.label} crashed: ${(e as Error).message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
