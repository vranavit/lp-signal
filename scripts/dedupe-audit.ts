/**
 * Phase 1 dedupe audit for the signals table (T1 commitments only).
 *
 * Mirrors the three SQL queries from the sprint brief but runs over
 * supabase-js since the SUPABASE_DB_URL pooler endpoint is not reachable
 * from this network. Read-only.
 *
 * QUERY 1 - True exact duplicates: same plan, same gp, same fund_name, same
 *           commitment_amount_usd, same approval_date.
 * QUERY 2 - Near-duplicate fund names: same plan + same gp + same amount,
 *           but distinct fund_name strings.
 * QUERY 3 - Near-duplicate GP names: same plan + same fund_name + same
 *           amount, but distinct gp strings.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Signal = {
  id: string;
  plan_id: string;
  signal_type: number;
  fields: Record<string, unknown> | null;
  commitment_amount_usd: number | null;
  confidence: number | null;
  prompt_version: string | null;
  document_id: string | null;
  preliminary: boolean | null;
  created_at: string;
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

function gpOf(s: Signal): string {
  const f = (s.fields ?? {}) as Record<string, unknown>;
  const v = f["gp"];
  return typeof v === "string" ? v : "";
}
function fundOf(s: Signal): string {
  const f = (s.fields ?? {}) as Record<string, unknown>;
  const v = f["fund_name"];
  return typeof v === "string" ? v : "";
}
function approvalOf(s: Signal): string {
  const f = (s.fields ?? {}) as Record<string, unknown>;
  const v = f["approval_date"];
  return typeof v === "string" ? v : "";
}

function fmtAmount(amt: number | null): string {
  if (amt == null) return "—";
  return `$${(amt / 1e6).toFixed(2)}M`;
}

async function main() {
  const supabase = createSupabaseAdminClient();
  const signals = await fetchAll<Signal>(
    supabase,
    "signals",
    "id, plan_id, signal_type, fields, commitment_amount_usd, confidence, prompt_version, document_id, preliminary, created_at",
    { column: "signal_type", value: 1 },
  );
  const { data: plans } = await supabase.from("plans").select("id, name");
  const planNameById = new Map((plans ?? []).map((p) => [p.id as string, p.name as string]));

  console.log(`# T1 commitment signals total: ${signals.length}\n`);

  // ── QUERY 1: exact duplicates on (plan, gp, fund_name, amount, approval_date)
  type Q1Group = {
    plan_id: string;
    gp: string;
    fund: string;
    amount: number | null;
    approval: string;
    rows: Signal[];
  };
  const q1Map = new Map<string, Q1Group>();
  for (const s of signals) {
    const key = [
      s.plan_id,
      gpOf(s),
      fundOf(s),
      s.commitment_amount_usd ?? "null",
      approvalOf(s),
    ].join("");
    let g = q1Map.get(key);
    if (!g) {
      g = {
        plan_id: s.plan_id,
        gp: gpOf(s),
        fund: fundOf(s),
        amount: s.commitment_amount_usd,
        approval: approvalOf(s),
        rows: [],
      };
      q1Map.set(key, g);
    }
    g.rows.push(s);
  }
  const q1Dups = Array.from(q1Map.values())
    .filter((g) => g.rows.length > 1)
    .sort((a, b) => b.rows.length - a.rows.length || (b.amount ?? 0) - (a.amount ?? 0));
  const q1ExtraRowCount = q1Dups.reduce((n, g) => n + (g.rows.length - 1), 0);

  console.log("=".repeat(90));
  console.log("QUERY 1 — exact duplicates on (plan, gp, fund_name, amount, approval_date)");
  console.log("=".repeat(90));
  console.log(`distinct duplicate groups: ${q1Dups.length}`);
  console.log(`total rows in those groups: ${q1Dups.reduce((n, g) => n + g.rows.length, 0)}`);
  console.log(`extra rows (would be deleted, keeping 1 per group): ${q1ExtraRowCount}\n`);
  if (q1Dups.length === 0) {
    console.log("(none)\n");
  } else {
    console.log(
      "plan | gp | fund | amount | approval_date | dup_count | scrape_dates | confs | prompts | docs",
    );
    console.log("-".repeat(180));
    for (const g of q1Dups.slice(0, 50)) {
      const plan = planNameById.get(g.plan_id) ?? g.plan_id;
      const dates = g.rows.map((r) => r.created_at.slice(0, 10)).join(",");
      const confs = g.rows.map((r) => (r.confidence ?? 0).toFixed(2)).join(",");
      const prompts = g.rows.map((r) => r.prompt_version ?? "—").join(",");
      const docs = g.rows.map((r) => (r.document_id ?? "—").slice(0, 8)).join(",");
      console.log(
        `${plan} | ${g.gp} | ${g.fund} | ${fmtAmount(g.amount)} | ${g.approval || "—"} | ${g.rows.length} | ${dates} | ${confs} | ${prompts} | ${docs}`,
      );
    }
    if (q1Dups.length > 50) console.log(`(... ${q1Dups.length - 50} more groups)`);
  }

  // ── QUERY 2: near-duplicate fund_name (same plan+gp+amount, distinct fund_name)
  type Q2Group = {
    plan_id: string;
    gp: string;
    amount: number | null;
    fundsToRows: Map<string, Signal[]>;
  };
  const q2Map = new Map<string, Q2Group>();
  for (const s of signals) {
    const key = [s.plan_id, gpOf(s), s.commitment_amount_usd ?? "null"].join("");
    let g = q2Map.get(key);
    if (!g) {
      g = { plan_id: s.plan_id, gp: gpOf(s), amount: s.commitment_amount_usd, fundsToRows: new Map() };
      q2Map.set(key, g);
    }
    const fund = fundOf(s);
    if (!g.fundsToRows.has(fund)) g.fundsToRows.set(fund, []);
    g.fundsToRows.get(fund)!.push(s);
  }
  const q2Cases = Array.from(q2Map.values())
    .filter((g) => g.fundsToRows.size > 1)
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));

  console.log("\n" + "=".repeat(90));
  console.log("QUERY 2 — near-duplicate fund_name (same plan+gp+amount, distinct fund_name)");
  console.log("=".repeat(90));
  console.log(`cases: ${q2Cases.length}\n`);
  if (q2Cases.length === 0) {
    console.log("(none)\n");
  } else {
    console.log("plan | gp | amount | distinct_funds | fund_variants");
    console.log("-".repeat(180));
    for (const g of q2Cases.slice(0, 30)) {
      const plan = planNameById.get(g.plan_id) ?? g.plan_id;
      const variants = Array.from(g.fundsToRows.keys());
      console.log(`${plan} | ${g.gp} | ${fmtAmount(g.amount)} | ${variants.length} | ${variants.map((v) => `"${v}"`).join("  |  ")}`);
    }
  }

  // ── QUERY 3: near-duplicate gp (same plan+fund+amount, distinct gp)
  type Q3Group = {
    plan_id: string;
    fund: string;
    amount: number | null;
    gpsToRows: Map<string, Signal[]>;
  };
  const q3Map = new Map<string, Q3Group>();
  for (const s of signals) {
    const key = [s.plan_id, fundOf(s), s.commitment_amount_usd ?? "null"].join("");
    let g = q3Map.get(key);
    if (!g) {
      g = { plan_id: s.plan_id, fund: fundOf(s), amount: s.commitment_amount_usd, gpsToRows: new Map() };
      q3Map.set(key, g);
    }
    const gp = gpOf(s);
    if (!g.gpsToRows.has(gp)) g.gpsToRows.set(gp, []);
    g.gpsToRows.get(gp)!.push(s);
  }
  const q3Cases = Array.from(q3Map.values())
    .filter((g) => g.gpsToRows.size > 1)
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));

  console.log("\n" + "=".repeat(90));
  console.log("QUERY 3 — near-duplicate gp (same plan+fund+amount, distinct gp)");
  console.log("=".repeat(90));
  console.log(`cases: ${q3Cases.length}\n`);
  if (q3Cases.length === 0) {
    console.log("(none)\n");
  } else {
    console.log("plan | fund | amount | distinct_gps | gp_variants");
    console.log("-".repeat(180));
    for (const g of q3Cases.slice(0, 30)) {
      const plan = planNameById.get(g.plan_id) ?? g.plan_id;
      const variants = Array.from(g.gpsToRows.keys());
      console.log(`${plan} | ${g.fund} | ${fmtAmount(g.amount)} | ${variants.length} | ${variants.map((v) => `"${v}"`).join("  |  ")}`);
    }
  }

  // ── Summary numbers requested in the brief
  console.log("\n" + "=".repeat(90));
  console.log("SUMMARY");
  console.log("=".repeat(90));
  console.log(`Q1 distinct duplicate groups: ${q1Dups.length}`);
  console.log(`Q1 extra rows (deletable, keep 1 per group): ${q1ExtraRowCount}`);
  console.log(`Q2 distinct cases (near-dup fund_name): ${q2Cases.length}`);
  console.log(`Q3 distinct cases (near-dup gp): ${q3Cases.length}`);

  // ── 10 most interesting cases across all three (by amount).
  type Interesting = {
    kind: "Q1" | "Q2" | "Q3";
    plan: string;
    detail: string;
    amount: number | null;
    rowsHint: string;
  };
  const interesting: Interesting[] = [];
  for (const g of q1Dups) {
    interesting.push({
      kind: "Q1",
      plan: planNameById.get(g.plan_id) ?? g.plan_id,
      detail: `gp="${g.gp}" fund="${g.fund}" approval=${g.approval || "—"}`,
      amount: g.amount,
      rowsHint: `${g.rows.length} rows; ids=${g.rows.map((r) => r.id.slice(0, 8)).join(",")}`,
    });
  }
  for (const g of q2Cases) {
    const variants = Array.from(g.fundsToRows.keys());
    interesting.push({
      kind: "Q2",
      plan: planNameById.get(g.plan_id) ?? g.plan_id,
      detail: `gp="${g.gp}" funds=${variants.map((v) => `"${v}"`).join(" / ")}`,
      amount: g.amount,
      rowsHint: `${variants.length} fund variants`,
    });
  }
  for (const g of q3Cases) {
    const variants = Array.from(g.gpsToRows.keys());
    interesting.push({
      kind: "Q3",
      plan: planNameById.get(g.plan_id) ?? g.plan_id,
      detail: `fund="${g.fund}" gps=${variants.map((v) => `"${v}"`).join(" / ")}`,
      amount: g.amount,
      rowsHint: `${variants.length} gp variants`,
    });
  }
  interesting.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
  console.log("\n=== top 10 most interesting dedupe cases by amount ===\n");
  for (const it of interesting.slice(0, 10)) {
    console.log(`[${it.kind}] ${it.plan} | ${fmtAmount(it.amount)} | ${it.detail} | ${it.rowsHint}`);
  }

  // ── $500M+ slice (the user's investigation focus).
  console.log("\n=== dedupe cases at >= $500M ===");
  const big = interesting.filter((it) => (it.amount ?? 0) >= 500_000_000);
  for (const it of big) {
    console.log(`[${it.kind}] ${it.plan} | ${fmtAmount(it.amount)} | ${it.detail} | ${it.rowsHint}`);
  }
  if (big.length === 0) console.log("(none)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
