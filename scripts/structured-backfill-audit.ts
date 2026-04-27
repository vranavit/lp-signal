/**
 * Phase 1 read-only audit for the structured-backfill sprint.
 *
 * Runs the user's literal query (gp_name, fund_name,
 * commitment_amount_usd, commitment_date) AND the actual-key-name
 * variant (gp, fund_name, amount_usd, approval_date) so the naming
 * mismatch is visible in one report. Then prints 10 sample signals
 * across at least 5 plans with full fields JSONB.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Signal = {
  id: string;
  plan_id: string;
  signal_type: number;
  fields: Record<string, unknown> | null;
  summary: string | null;
  created_at: string;
  prompt_version: string | null;
};

async function fetchAll<T>(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  table: string,
  columns: string,
  filter?: { column: string; value: number },
): Promise<T[]> {
  const all: T[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let q = supabase.from(table).select(columns).range(from, from + pageSize - 1);
    if (filter) q = q.eq(filter.column, filter.value);
    const { data, error } = await q;
    if (error) throw new Error(`${table} fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < pageSize) break;
  }
  return all;
}

async function main() {
  const supabase = createSupabaseAdminClient();
  const t1 = await fetchAll<Signal & { commitment_amount_usd: number | null }>(
    supabase,
    "signals",
    "id, plan_id, signal_type, fields, summary, created_at, prompt_version, commitment_amount_usd",
    { column: "signal_type", value: 1 },
  );
  const { data: plans } = await supabase.from("plans").select("id, name");
  const planNameById = new Map((plans ?? []).map((p) => [p.id as string, p.name as string]));

  const total = t1.length;

  // ── Variant A: literal user query (gp_name, commitment_amount_usd, commitment_date).
  let withGpName = 0;
  let withFundNameLiteral = 0;
  let withCommitmentAmountUsd = 0;
  let withCommitmentDate = 0;

  // ── Variant B: actual v2.3 keys (gp, fund_name, amount_usd, approval_date).
  let withGp = 0;
  let withFundName = 0;
  let withAmountUsd = 0;
  let withApprovalDate = 0;

  // Diagnostic: which keys are present, with frequency.
  const keyFreq = new Map<string, number>();

  for (const s of t1) {
    const f = (s.fields ?? {}) as Record<string, unknown>;

    const gpName = f["gp_name"];
    const fundNameLiteral = f["fund_name"];
    const cau = f["commitment_amount_usd"];
    const cd = f["commitment_date"];
    if (typeof gpName === "string" && gpName.trim().length > 0) withGpName++;
    if (typeof fundNameLiteral === "string" && fundNameLiteral.trim().length > 0)
      withFundNameLiteral++;
    if (cau !== null && cau !== undefined) withCommitmentAmountUsd++;
    if (cd !== null && cd !== undefined) withCommitmentDate++;

    const gp = f["gp"];
    const fundName = f["fund_name"];
    const amount = f["amount_usd"];
    const apdate = f["approval_date"];
    if (typeof gp === "string" && gp.trim().length > 0) withGp++;
    if (typeof fundName === "string" && fundName.trim().length > 0) withFundName++;
    if (amount !== null && amount !== undefined) withAmountUsd++;
    if (typeof apdate === "string" && apdate.trim().length > 0) withApprovalDate++;

    for (const k of Object.keys(f)) {
      keyFreq.set(k, (keyFreq.get(k) ?? 0) + 1);
    }
  }

  console.log("=== Phase 1 audit: structured-field coverage on T1 commitment signals ===\n");
  console.log(`total_commitment_signals: ${total}\n`);

  console.log("--- Variant A: keys named in the sprint brief ---");
  console.log(`with_gp_name (fields->>'gp_name'):                  ${withGpName} / ${total} (${pct(withGpName, total)})`);
  console.log(`with_fund_name (fields->>'fund_name'):              ${withFundNameLiteral} / ${total} (${pct(withFundNameLiteral, total)})`);
  console.log(`with_dollars (fields->>'commitment_amount_usd'):    ${withCommitmentAmountUsd} / ${total} (${pct(withCommitmentAmountUsd, total)})`);
  console.log(`with_date (fields->>'commitment_date'):             ${withCommitmentDate} / ${total} (${pct(withCommitmentDate, total)})\n`);

  console.log("--- Variant B: actual keys emitted by v2.3 (per lib/classifier/prompt.ts) ---");
  console.log(`with_gp (fields->>'gp'):                            ${withGp} / ${total} (${pct(withGp, total)})`);
  console.log(`with_fund_name (fields->>'fund_name'):              ${withFundName} / ${total} (${pct(withFundName, total)})`);
  console.log(`with_amount_usd (fields->>'amount_usd'):            ${withAmountUsd} / ${total} (${pct(withAmountUsd, total)})`);
  console.log(`with_approval_date (fields->>'approval_date'):      ${withApprovalDate} / ${total} (${pct(withApprovalDate, total)})\n`);

  console.log("--- All keys present in fields JSONB across T1 signals ---");
  const sortedKeys = Array.from(keyFreq.entries()).sort((a, b) => b[1] - a[1]);
  for (const [k, n] of sortedKeys) {
    console.log(`  ${k.padEnd(32)} ${n} (${pct(n, total)})`);
  }

  // ── Variant C: top-level signals.commitment_amount_usd column.
  let withTopLevelAmount = 0;
  for (const s of t1) {
    if ((s as { commitment_amount_usd: number | null }).commitment_amount_usd != null)
      withTopLevelAmount++;
  }
  console.log(`\n--- Variant C: top-level signals.commitment_amount_usd column (bigint) ---`);
  console.log(`with_commitment_amount_usd (top-level): ${withTopLevelAmount} / ${total} (${pct(withTopLevelAmount, total)})`);

  // ── 10 sample signals, diverse across at least 5 plans.
  console.log("\n--- 10 sample T1 signals (diverse plans) ---\n");
  const byPlan = new Map<string, Signal[]>();
  for (const s of t1) {
    if (!byPlan.has(s.plan_id)) byPlan.set(s.plan_id, []);
    byPlan.get(s.plan_id)!.push(s);
  }
  // Take 2 from each of the top 5 plans by row count.
  const planOrder = Array.from(byPlan.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 5);
  const samples: Signal[] = [];
  for (const [, sigs] of planOrder) {
    // newest first.
    sigs.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
    samples.push(...sigs.slice(0, 2));
  }
  for (const s of samples.slice(0, 10)) {
    const planName = planNameById.get(s.plan_id) ?? s.plan_id;
    const date =
      typeof (s.fields ?? {})["approval_date"] === "string"
        ? ((s.fields ?? {})["approval_date"] as string)
        : s.created_at?.slice(0, 10) ?? "";
    const summary = (s.summary ?? "").replace(/\s+/g, " ").slice(0, 220);
    const fields = JSON.stringify(s.fields ?? {});
    console.log(`[${planName}] | ${date} | ${summary}`);
    console.log(`  fields: ${fields}\n`);
  }
}

function pct(n: number, total: number): string {
  if (total === 0) return "0.0%";
  return `${((n / total) * 100).toFixed(1)}%`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
