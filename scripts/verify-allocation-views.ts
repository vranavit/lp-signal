/**
 * Programmatic correctness audit for pension_allocations_latest +
 * pension_allocations_rollup views (migration 20260501000012).
 *
 * Five checks, each logging PASS or FAIL with row detail. Exit 0 if
 * all pass, exit 1 if any fail. Re-runnable.
 *
 * Usage:
 *   set -a; source .env.local; set +a
 *   pnpm tsx scripts/verify-allocation-views.ts
 */

import { Client } from "pg";

type Row = Record<string, unknown>;

let failures = 0;

function log(label: string, ok: boolean, detail?: string) {
  const tag = ok ? "PASS" : "FAIL";
  if (!ok) failures++;
  console.log(`[${tag}] ${label}${detail ? `\n        ${detail}` : ""}`);
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return v.toString();
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

async function main() {
  const c = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  try {
    console.log("=== pension_allocations view correctness audit ===\n");

    // -------------------------------------------------------------------
    // Check 1: latest view returns exactly one as_of_date per
    // (plan_id, asset_class).
    // -------------------------------------------------------------------
    {
      const { rows } = await c.query<Row>(`
        select plan_id, asset_class, count(distinct as_of_date)::int as date_count
        from public.pension_allocations_latest
        group by plan_id, asset_class
        having count(distinct as_of_date) > 1
      `);
      if (rows.length === 0) {
        log("Check 1: latest view has exactly one as_of_date per (plan, asset_class)", true);
      } else {
        log(
          "Check 1: latest view has exactly one as_of_date per (plan, asset_class)",
          false,
          `${rows.length} combo(s) span multiple dates:`,
        );
        for (const r of rows) {
          console.log(
            `        plan_id=${fmt(r.plan_id)} asset_class=${fmt(r.asset_class)} date_count=${fmt(r.date_count)}`,
          );
        }
      }
    }

    // -------------------------------------------------------------------
    // Check 2: rollup.target_pct equals SUM of underlying latest rows
    // (within 0.01 tolerance for floating-point).
    // -------------------------------------------------------------------
    {
      const { rows } = await c.query<Row>(`
        with child_sums as (
          select plan_id, asset_class, sum(target_pct)::numeric as expected_sum
          from public.pension_allocations_latest
          group by plan_id, asset_class
        )
        select r.plan_id, p.name as plan_name, r.asset_class,
               r.target_pct::numeric as rollup_target,
               s.expected_sum,
               abs(r.target_pct::numeric - s.expected_sum) as diff
        from public.pension_allocations_rollup r
        join child_sums s using (plan_id, asset_class)
        join public.plans p on p.id = r.plan_id
        where abs(r.target_pct::numeric - s.expected_sum) > 0.01
        order by p.name, r.asset_class
      `);
      if (rows.length === 0) {
        log("Check 2: rollup.target_pct equals SUM of latest children (±0.01)", true);
      } else {
        log(
          "Check 2: rollup.target_pct equals SUM of latest children (±0.01)",
          false,
          `${rows.length} mismatch(es):`,
        );
        for (const r of rows) {
          console.log(
            `        ${fmt(r.plan_name)} / ${fmt(r.asset_class)}: rollup=${fmt(r.rollup_target)} children_sum=${fmt(r.expected_sum)} diff=${fmt(r.diff)}`,
          );
        }
      }
    }

    // -------------------------------------------------------------------
    // Check 3: NULL guard on actual_pct.
    //   (a) ANY child NULL  -> parent.actual_pct IS NULL.
    //   (b) ALL children populated -> parent.actual_pct = SUM(children).
    // -------------------------------------------------------------------
    {
      const { rows } = await c.query<Row>(`
        with summary as (
          select plan_id, asset_class,
                 bool_and(actual_pct is not null) as all_have_actual,
                 sum(actual_pct)::numeric as actual_sum,
                 count(*) filter (where actual_pct is null)::int as null_children
          from public.pension_allocations_latest
          group by plan_id, asset_class
        )
        select r.plan_id, p.name as plan_name, r.asset_class,
               r.actual_pct::numeric as rollup_actual,
               s.all_have_actual,
               s.actual_sum,
               s.null_children,
               case
                 when s.all_have_actual = false and r.actual_pct is not null
                   then 'should_be_null'
                 when s.all_have_actual = true
                   and (r.actual_pct is null
                        or abs(r.actual_pct::numeric - s.actual_sum) > 0.01)
                   then 'sum_mismatch'
                 else 'ok'
               end as violation
        from public.pension_allocations_rollup r
        join summary s using (plan_id, asset_class)
        join public.plans p on p.id = r.plan_id
        where (s.all_have_actual = false and r.actual_pct is not null)
           or (s.all_have_actual = true
               and (r.actual_pct is null
                    or abs(r.actual_pct::numeric - s.actual_sum) > 0.01))
        order by p.name, r.asset_class
      `);
      if (rows.length === 0) {
        log("Check 3: NULL guard on actual_pct (any child NULL -> parent NULL; all populated -> sum)", true);
      } else {
        log(
          "Check 3: NULL guard on actual_pct (any child NULL -> parent NULL; all populated -> sum)",
          false,
          `${rows.length} violation(s):`,
        );
        for (const r of rows) {
          console.log(
            `        ${fmt(r.plan_name)} / ${fmt(r.asset_class)}: violation=${fmt(r.violation)} rollup_actual=${fmt(r.rollup_actual)} all_have_actual=${fmt(r.all_have_actual)} children_sum=${fmt(r.actual_sum)} null_children=${fmt(r.null_children)}`,
          );
        }
      }
    }

    // -------------------------------------------------------------------
    // Check 4: no row loss / inflation.
    //   raw >= latest >= rollup
    // -------------------------------------------------------------------
    {
      const counts = await c.query<Row>(`
        select
          (select count(*) from public.pension_allocations)::int        as raw_n,
          (select count(*) from public.pension_allocations_latest)::int as latest_n,
          (select count(*) from public.pension_allocations_rollup)::int as rollup_n
      `);
      const r = counts.rows[0];
      const rawN = Number(r.raw_n);
      const latestN = Number(r.latest_n);
      const rollupN = Number(r.rollup_n);
      const latestOk = latestN <= rawN;
      const rollupOk = rollupN <= latestN;
      log(
        "Check 4a: latest <= raw",
        latestOk,
        latestOk ? `${latestN} <= ${rawN}` : `${latestN} > ${rawN} -- JOIN duplication suspected`,
      );
      log(
        "Check 4b: rollup <= latest",
        rollupOk,
        rollupOk ? `${rollupN} <= ${latestN}` : `${rollupN} > ${latestN} -- group_by duplication suspected`,
      );
    }

    // -------------------------------------------------------------------
    // Check 5: hand-picked spot checks against the rollup view.
    // -------------------------------------------------------------------
    {
      const cases: Array<{
        plan: string;
        asset_class: string;
        expectTarget: number;
        expectActual: number | null;
      }> = [
        { plan: "Michigan SMRS", asset_class: "Public Equity", expectTarget: 40, expectActual: 35.7 },
        { plan: "LACERA", asset_class: "Fixed Income", expectTarget: 18, expectActual: 17.4 },
        // Ohio PERS Fixed Income actuals landed in v1.2-cafr re-classify
        // (Phase-3 Round 1, Apr 2026): $26.78B Defined Benefit Fixed Income /
        // $103.15B AUM = 25.9%. The pre-v1.2 row was target-only.
        { plan: "Ohio PERS", asset_class: "Fixed Income", expectTarget: 24, expectActual: 25.9 },
        { plan: "CalSTRS", asset_class: "Other", expectTarget: 10, expectActual: 9.1 },
      ];
      for (const tc of cases) {
        const { rows } = await c.query<Row>(
          `
          select r.target_pct::numeric as target_pct, r.actual_pct::numeric as actual_pct
          from public.pension_allocations_rollup r
          join public.plans p on p.id = r.plan_id
          where p.name = $1 and r.asset_class = $2
          `,
          [tc.plan, tc.asset_class],
        );
        if (rows.length === 0) {
          log(
            `Check 5: ${tc.plan} / ${tc.asset_class} present in rollup`,
            false,
            "no rollup row found",
          );
          continue;
        }
        const got = rows[0];
        const targetOk = Math.abs(Number(got.target_pct) - tc.expectTarget) < 0.01;
        const actualOk =
          tc.expectActual === null
            ? got.actual_pct === null
            : got.actual_pct !== null &&
              Math.abs(Number(got.actual_pct) - tc.expectActual) < 0.01;
        const ok = targetOk && actualOk;
        log(
          `Check 5: ${tc.plan} / ${tc.asset_class} target=${tc.expectTarget} actual=${fmt(tc.expectActual)}`,
          ok,
          ok
            ? undefined
            : `got target=${fmt(got.target_pct)} actual=${fmt(got.actual_pct)}`,
        );
      }
    }

    // -------------------------------------------------------------------
    // Check 7: no duplicate-natural-key T1 commitment signal rows.
    //
    // After the dedupe sprint (Phase-3, Apr 2026) added migration
    // 20260501000015's unique partial index on
    //   (plan_id, fields->>'gp', fields->>'fund_name',
    //    commitment_amount_usd, coalesce(fields->>'approval_date', '__null__'))
    // this should always be zero in steady state. The check guards against
    // direct DB writes that bypass the index (e.g. ad-hoc SQL), or
    // accidental drops of the index.
    // -------------------------------------------------------------------
    {
      const { rows } = await c.query<Row>(`
        select plan_id,
               fields->>'gp' as gp,
               fields->>'fund_name' as fund_name,
               commitment_amount_usd,
               fields->>'approval_date' as approval_date,
               count(*)::int as n,
               array_agg(id) as ids
        from public.signals
        where signal_type = 1 and seed_data = false
        group by plan_id,
                 fields->>'gp',
                 fields->>'fund_name',
                 commitment_amount_usd,
                 coalesce(fields->>'approval_date', '__null__')
        having count(*) > 1
      `);
      if (rows.length === 0) {
        log("Check 7: no duplicate-natural-key T1 commitment signal rows", true);
      } else {
        log(
          "Check 7: no duplicate-natural-key T1 commitment signal rows",
          false,
          `${rows.length} duplicate group(s):`,
        );
        for (const r of rows) {
          console.log(
            `        plan=${fmt(r.plan_id)} gp=${fmt(r.gp)} fund=${fmt(r.fund_name)} amount=${fmt(r.commitment_amount_usd)} approval=${fmt(r.approval_date)} n=${fmt(r.n)} ids=${fmt(r.ids)}`,
          );
        }
      }
    }

    // -------------------------------------------------------------------
    // Check 6: every pension_allocations row has at least one of
    // (target_pct, actual_pct) non-null. Mirrors the Zod refine added in
    // v1.3-cafr. Catches rows that snuck in via direct DB writes / older
    // prompt versions that didn't enforce the constraint.
    // -------------------------------------------------------------------
    {
      const { rows } = await c.query<Row>(`
        select pa.id, p.name as plan_name, pa.asset_class, pa.sub_class, pa.as_of_date, pa.prompt_version
        from public.pension_allocations pa
        join public.plans p on p.id = pa.plan_id
        where pa.target_pct is null and pa.actual_pct is null
        order by p.name, pa.asset_class, pa.sub_class
      `);
      if (rows.length === 0) {
        log("Check 6: every row has at least one of target_pct or actual_pct non-null", true);
      } else {
        log(
          "Check 6: every row has at least one of target_pct or actual_pct non-null",
          false,
          `${rows.length} data-free row(s):`,
        );
        for (const r of rows) {
          console.log(
            `        ${fmt(r.plan_name)} / ${fmt(r.asset_class)}${r.sub_class ? ` · ${fmt(r.sub_class)}` : ""} (${fmt(r.as_of_date)}, ${fmt(r.prompt_version)}) id=${fmt(r.id)}`,
          );
        }
      }
    }

    // -------------------------------------------------------------------
    // Summary
    // -------------------------------------------------------------------
    console.log("");
    if (failures === 0) {
      console.log("OVERALL: PASS -- all checks satisfied");
      process.exit(0);
    } else {
      console.log(`OVERALL: FAIL -- ${failures} check(s) failed`);
      process.exit(1);
    }
  } finally {
    await c.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
