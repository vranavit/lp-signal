/**
 * Final coverage query for the actuals-gap sprint (Phase-3 Round 4).
 * Lists per-plan: asset_class rows, rows_with_actual_pct, AUM, dominant
 * source URL, dominant prompt_version, dominant as_of_date.
 *
 * Used to confirm the recovery from the v1.2/v1.3-cafr classifier rollout
 * and to seed the commit-message coverage table.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Row = {
  plan_id: string;
  asset_class: string;
  sub_class: string | null;
  target_pct: number | null;
  actual_pct: number | null;
  total_plan_aum_usd: number | null;
  as_of_date: string;
  prompt_version: string | null;
  source_document_id: string | null;
};

async function fetchAll<T>(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  table: string,
  columns: string,
): Promise<T[]> {
  const all: T[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table} fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < pageSize) break;
  }
  return all;
}

async function main() {
  const supabase = createSupabaseAdminClient();
  const rows = await fetchAll<Row>(
    supabase,
    "pension_allocations_latest",
    "plan_id, asset_class, sub_class, target_pct, actual_pct, total_plan_aum_usd, as_of_date, prompt_version, source_document_id",
  );
  const { data: plans } = await supabase.from("plans").select("id, name");
  const planNameById = new Map((plans ?? []).map((p) => [p.id as string, p.name as string]));

  // Group by plan_id.
  const byPlan = new Map<string, Row[]>();
  for (const r of rows) {
    if (!byPlan.has(r.plan_id)) byPlan.set(r.plan_id, []);
    byPlan.get(r.plan_id)!.push(r);
  }

  // Resolve source_url per source_document_id (one round-trip).
  const sourceIds = Array.from(
    new Set(rows.map((r) => r.source_document_id).filter((x): x is string => !!x)),
  );
  const { data: docs } = await supabase
    .from("documents")
    .select("id, source_url")
    .in("id", sourceIds);
  const sourceUrlById = new Map((docs ?? []).map((d) => [d.id as string, d.source_url as string]));

  type Summary = {
    plan: string;
    rows: number;
    rows_with_actual: number;
    rows_with_target: number;
    aum_usd: number | null;
    as_of: string;
    prompt: string;
    source_url: string;
  };
  const summaries: Summary[] = [];
  for (const [plan_id, planRows] of byPlan) {
    const plan = planNameById.get(plan_id) ?? plan_id;
    const rowCount = planRows.length;
    const rowsWithActual = planRows.filter((r) => r.actual_pct != null).length;
    const rowsWithTarget = planRows.filter((r) => r.target_pct != null).length;
    const aum = planRows.find((r) => r.total_plan_aum_usd != null)?.total_plan_aum_usd ?? null;
    const promptCounts = new Map<string, number>();
    for (const r of planRows) {
      const v = r.prompt_version ?? "—";
      promptCounts.set(v, (promptCounts.get(v) ?? 0) + 1);
    }
    const dominantPrompt =
      Array.from(promptCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
    const asOfCounts = new Map<string, number>();
    for (const r of planRows) {
      asOfCounts.set(r.as_of_date, (asOfCounts.get(r.as_of_date) ?? 0) + 1);
    }
    const dominantAsOf = Array.from(asOfCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
    const sourceCounts = new Map<string, number>();
    for (const r of planRows) {
      const u = r.source_document_id ? sourceUrlById.get(r.source_document_id) ?? "—" : "—";
      sourceCounts.set(u, (sourceCounts.get(u) ?? 0) + 1);
    }
    const dominantSource = Array.from(sourceCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";

    summaries.push({
      plan,
      rows: rowCount,
      rows_with_actual: rowsWithActual,
      rows_with_target: rowsWithTarget,
      aum_usd: aum,
      as_of: dominantAsOf,
      prompt: dominantPrompt,
      source_url: dominantSource,
    });
  }
  summaries.sort((a, b) => (b.aum_usd ?? 0) - (a.aum_usd ?? 0));

  console.log(
    "plan | rows | rows_with_target | rows_with_actual | aum_$B | as_of | prompt_version | source",
  );
  console.log("-".repeat(140));
  for (const s of summaries) {
    const aumStr = s.aum_usd != null ? (s.aum_usd / 1e9).toFixed(1) : "—";
    const src = s.source_url.length > 60 ? "…" + s.source_url.slice(-58) : s.source_url;
    console.log(
      `${s.plan} | ${s.rows} | ${s.rows_with_target} | ${s.rows_with_actual} | $${aumStr}B | ${s.as_of} | ${s.prompt} | ${src}`,
    );
  }

  const totalActuals = summaries.reduce((n, s) => n + s.rows_with_actual, 0);
  const totalRows = summaries.reduce((n, s) => n + s.rows, 0);
  const plansWithAnyActuals = summaries.filter((s) => s.rows_with_actual > 0).length;
  const totalPlans = summaries.length;
  const aumWithActuals = summaries
    .filter((s) => s.rows_with_actual > 0)
    .reduce((n, s) => n + (s.aum_usd ?? 0), 0);
  const aumAll = summaries.reduce((n, s) => n + (s.aum_usd ?? 0), 0);
  console.log("");
  console.log(
    `Plans with ≥1 actual_pct: ${plansWithAnyActuals}/${totalPlans} · rows with actual_pct: ${totalActuals}/${totalRows}`,
  );
  console.log(
    `AUM with ≥1 actual_pct row: $${(aumWithActuals / 1e9).toFixed(1)}B / $${(aumAll / 1e9).toFixed(1)}B = ${((aumWithActuals / aumAll) * 100).toFixed(1)}%`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
