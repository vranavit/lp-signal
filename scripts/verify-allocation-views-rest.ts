/**
 * supabase-js port of scripts/verify-allocation-views.ts.
 *
 * Same five logical checks (with Check 4 split into 4a + 4b and Check 5
 * into 4 hand-picked sub-cases for 9 total PASS/FAIL lines), implemented
 * over PostgREST instead of direct pg. Used when the SUPABASE_DB_URL
 * pooler endpoint isn't reachable from the local network.
 *
 * Usage:
 *   pnpm tsx scripts/verify-allocation-views-rest.ts
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

let failures = 0;

function log(label: string, ok: boolean, detail?: string) {
  const tag = ok ? "PASS" : "FAIL";
  if (!ok) failures++;
  console.log(`[${tag}] ${label}${detail ? `\n        ${detail}` : ""}`);
}

type LatestRow = {
  plan_id: string;
  asset_class: string;
  sub_class: string | null;
  as_of_date: string;
  target_pct: number | null;
  actual_pct: number | null;
};

type RollupRow = {
  plan_id: string;
  asset_class: string;
  target_pct: number | null;
  actual_pct: number | null;
};

async function fetchAll<T>(supabase: ReturnType<typeof createSupabaseAdminClient>, table: string, columns: string): Promise<T[]> {
  const all: T[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + pageSize - 1);
    if (error) throw new Error(`${table} fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < pageSize) break;
  }
  return all;
}

async function main() {
  console.log("=== pension_allocations view correctness audit (REST) ===\n");
  const supabase = createSupabaseAdminClient();

  const latest = await fetchAll<LatestRow>(
    supabase,
    "pension_allocations_latest",
    "plan_id, asset_class, sub_class, as_of_date, target_pct, actual_pct",
  );
  const rollup = await fetchAll<RollupRow>(
    supabase,
    "pension_allocations_rollup",
    "plan_id, asset_class, target_pct, actual_pct",
  );
  const raw = await fetchAll<{ id: string }>(supabase, "pension_allocations", "id");
  const { data: plans } = await supabase.from("plans").select("id, name");
  const planNameById = new Map((plans ?? []).map((p) => [p.id as string, p.name as string]));

  // Index latest rows by (plan, asset_class).
  const latestGroups = new Map<string, LatestRow[]>();
  for (const r of latest) {
    const key = `${r.plan_id}::${r.asset_class}`;
    if (!latestGroups.has(key)) latestGroups.set(key, []);
    latestGroups.get(key)!.push(r);
  }

  // Check 1: latest view returns exactly one as_of_date per (plan, asset_class).
  {
    const violations: Array<{ plan_id: string; asset_class: string; date_count: number }> = [];
    for (const [key, rows] of latestGroups) {
      const dates = new Set(rows.map((r) => r.as_of_date));
      if (dates.size > 1) {
        const [plan_id, asset_class] = key.split("::");
        violations.push({ plan_id, asset_class, date_count: dates.size });
      }
    }
    if (violations.length === 0) {
      log("Check 1: latest view has exactly one as_of_date per (plan, asset_class)", true);
    } else {
      log(
        "Check 1: latest view has exactly one as_of_date per (plan, asset_class)",
        false,
        `${violations.length} combo(s) span multiple dates:`,
      );
      for (const v of violations) {
        console.log(
          `        plan=${planNameById.get(v.plan_id) ?? v.plan_id} asset_class=${v.asset_class} date_count=${v.date_count}`,
        );
      }
    }
  }

  // Check 2: rollup.target_pct equals SUM of underlying latest rows (±0.01).
  {
    const rollupByKey = new Map(rollup.map((r) => [`${r.plan_id}::${r.asset_class}`, r]));
    const violations: Array<{ plan_name: string; asset_class: string; rollup: number; expected: number }> = [];
    for (const [key, rows] of latestGroups) {
      const [plan_id, asset_class] = key.split("::");
      const rollupRow = rollupByKey.get(key);
      if (!rollupRow) continue;
      const sumTarget = rows.reduce((s, r) => s + (r.target_pct ?? 0), 0);
      const got = rollupRow.target_pct ?? 0;
      if (Math.abs(got - sumTarget) > 0.01) {
        violations.push({
          plan_name: planNameById.get(plan_id) ?? plan_id,
          asset_class,
          rollup: got,
          expected: sumTarget,
        });
      }
    }
    if (violations.length === 0) {
      log("Check 2: rollup.target_pct equals SUM of latest children (±0.01)", true);
    } else {
      log(
        "Check 2: rollup.target_pct equals SUM of latest children (±0.01)",
        false,
        `${violations.length} mismatch(es):`,
      );
      for (const v of violations) {
        console.log(`        ${v.plan_name} / ${v.asset_class}: rollup=${v.rollup} children_sum=${v.expected}`);
      }
    }
  }

  // Check 3: NULL guard on actual_pct.
  {
    const rollupByKey = new Map(rollup.map((r) => [`${r.plan_id}::${r.asset_class}`, r]));
    const violations: Array<{
      plan_name: string;
      asset_class: string;
      violation: string;
      rollup_actual: number | null;
      all_have_actual: boolean;
      actual_sum: number;
      null_children: number;
    }> = [];
    for (const [key, rows] of latestGroups) {
      const [plan_id, asset_class] = key.split("::");
      const rollupRow = rollupByKey.get(key);
      if (!rollupRow) continue;
      const allHaveActual = rows.every((r) => r.actual_pct !== null);
      const actualSum = rows.reduce((s, r) => s + (r.actual_pct ?? 0), 0);
      const nullChildren = rows.filter((r) => r.actual_pct === null).length;
      const ra = rollupRow.actual_pct;
      let violation: string | null = null;
      if (!allHaveActual && ra !== null) violation = "should_be_null";
      else if (allHaveActual && (ra === null || Math.abs((ra ?? 0) - actualSum) > 0.01))
        violation = "sum_mismatch";
      if (violation) {
        violations.push({
          plan_name: planNameById.get(plan_id) ?? plan_id,
          asset_class,
          violation,
          rollup_actual: ra,
          all_have_actual: allHaveActual,
          actual_sum: actualSum,
          null_children: nullChildren,
        });
      }
    }
    if (violations.length === 0) {
      log("Check 3: NULL guard on actual_pct (any child NULL -> parent NULL; all populated -> sum)", true);
    } else {
      log(
        "Check 3: NULL guard on actual_pct (any child NULL -> parent NULL; all populated -> sum)",
        false,
        `${violations.length} violation(s):`,
      );
      for (const v of violations) {
        console.log(
          `        ${v.plan_name} / ${v.asset_class}: violation=${v.violation} rollup_actual=${v.rollup_actual} all_have_actual=${v.all_have_actual} children_sum=${v.actual_sum} null_children=${v.null_children}`,
        );
      }
    }
  }

  // Check 4: no row loss / inflation. raw >= latest >= rollup.
  {
    const rawN = raw.length;
    const latestN = latest.length;
    const rollupN = rollup.length;
    const latestOk = latestN <= rawN;
    const rollupOk = rollupN <= latestN;
    log("Check 4a: latest <= raw", latestOk, `${latestN} <= ${rawN}`);
    log("Check 4b: rollup <= latest", rollupOk, `${rollupN} <= ${latestN}`);
  }

  // Check 5: hand-picked spot checks against the rollup view.
  {
    const cases: Array<{ plan: string; asset_class: string; expectTarget: number; expectActual: number | null }> = [
      { plan: "Michigan SMRS", asset_class: "Public Equity", expectTarget: 40, expectActual: 35.7 },
      { plan: "LACERA", asset_class: "Fixed Income", expectTarget: 18, expectActual: 17.4 },
      // Ohio PERS Fixed Income actuals landed in v1.2-cafr re-classify
      // (Phase-3 Round 1, Apr 2026): $26.78B Defined Benefit Fixed Income /
      // $103.15B AUM = 25.9%. The pre-v1.2 row was target-only.
      { plan: "Ohio PERS", asset_class: "Fixed Income", expectTarget: 24, expectActual: 25.9 },
      { plan: "CalSTRS", asset_class: "Other", expectTarget: 10, expectActual: 9.1 },
    ];
    for (const tc of cases) {
      const planId = (plans ?? []).find((p) => p.name === tc.plan)?.id as string | undefined;
      if (!planId) {
        log(`Check 5: ${tc.plan} / ${tc.asset_class} target=${tc.expectTarget} actual=${tc.expectActual}`, false, `plan ${tc.plan} not found`);
        continue;
      }
      const got = rollup.find((r) => r.plan_id === planId && r.asset_class === tc.asset_class);
      if (!got) {
        log(`Check 5: ${tc.plan} / ${tc.asset_class} present in rollup`, false, "no rollup row found");
        continue;
      }
      const targetOk = Math.abs((got.target_pct ?? 0) - tc.expectTarget) < 0.01;
      const actualOk =
        tc.expectActual === null
          ? got.actual_pct === null
          : got.actual_pct !== null && Math.abs((got.actual_pct ?? 0) - tc.expectActual) < 0.01;
      const ok = targetOk && actualOk;
      log(
        `Check 5: ${tc.plan} / ${tc.asset_class} target=${tc.expectTarget} actual=${tc.expectActual}`,
        ok,
        ok ? undefined : `got target=${got.target_pct} actual=${got.actual_pct}`,
      );
    }
  }

  // Check 6: every pension_allocations row has at least one of (target_pct, actual_pct) non-null.
  {
    type RawRow = {
      id: string;
      plan_id: string;
      asset_class: string;
      sub_class: string | null;
      as_of_date: string;
      prompt_version: string | null;
      target_pct: number | null;
      actual_pct: number | null;
    };
    const rawRows = await fetchAll<RawRow>(
      supabase,
      "pension_allocations",
      "id, plan_id, asset_class, sub_class, as_of_date, prompt_version, target_pct, actual_pct",
    );
    const violations = rawRows.filter((r) => r.target_pct === null && r.actual_pct === null);
    if (violations.length === 0) {
      log("Check 6: every row has at least one of target_pct or actual_pct non-null", true);
    } else {
      log(
        "Check 6: every row has at least one of target_pct or actual_pct non-null",
        false,
        `${violations.length} data-free row(s):`,
      );
      for (const v of violations) {
        const sc = v.sub_class ? ` · ${v.sub_class}` : "";
        console.log(
          `        ${planNameById.get(v.plan_id) ?? v.plan_id} / ${v.asset_class}${sc} (${v.as_of_date}, ${v.prompt_version ?? "—"}) id=${v.id}`,
        );
      }
    }
  }

  console.log("");
  if (failures === 0) {
    console.log("OVERALL: PASS -- all checks satisfied");
    process.exit(0);
  } else {
    console.log(`OVERALL: FAIL -- ${failures} check(s) failed`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
