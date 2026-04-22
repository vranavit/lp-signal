/**
 * Detect target allocation policy changes by comparing the two most recent
 * pension_allocations entries per (plan, asset_class) pair. Inserts a row
 * into allocation_policy_changes when the target moves by more than
 * MIN_CHANGE_PP percentage points.
 *
 * Idempotent: the unique index on (plan, asset_class, as_of_date_previous,
 * as_of_date_new) makes re-runs no-ops for already-known changes.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/detect-policy-changes.ts
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const MIN_CHANGE_PP = 0.25;

type AllocationRow = {
  plan_id: string;
  asset_class: string;
  as_of_date: string;
  target_pct: number;
  total_plan_aum_usd: number | null;
};

async function main() {
  const s = createSupabaseAdminClient();

  // Pull all accepted (non-preliminary) allocations. Group by (plan,
  // asset_class) and take the two most recent dates per group.
  const { data, error } = await s
    .from("pension_allocations")
    .select("plan_id, asset_class, as_of_date, target_pct, total_plan_aum_usd")
    .eq("preliminary", false)
    .order("plan_id")
    .order("asset_class")
    .order("as_of_date", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as AllocationRow[];

  type Key = string;
  const byKey = new Map<Key, AllocationRow[]>();
  for (const r of rows) {
    const k = `${r.plan_id}|${r.asset_class}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(r);
  }

  type Change = {
    plan_id: string;
    asset_class: string;
    previous_target_pct: number;
    new_target_pct: number;
    as_of_date_previous: string;
    as_of_date_new: string;
    implied_usd_delta: number | null;
  };
  const changes: Change[] = [];

  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    // Dedupe: same as_of_date for one (plan, asset_class) means the
    // classifier emitted multiple rows for that snapshot. Keep one per date.
    const byDate = new Map<string, AllocationRow>();
    for (const r of list) {
      if (!byDate.has(r.as_of_date)) byDate.set(r.as_of_date, r);
    }
    const ordered = Array.from(byDate.values()).sort((a, b) =>
      b.as_of_date.localeCompare(a.as_of_date),
    );
    if (ordered.length < 2) continue;

    const newer = ordered[0];
    const older = ordered[1];
    const delta = Number(newer.target_pct) - Number(older.target_pct);
    if (Math.abs(delta) <= MIN_CHANGE_PP) continue;

    const aum = newer.total_plan_aum_usd ?? older.total_plan_aum_usd ?? null;
    const impliedUsdDelta =
      aum != null ? Math.round((delta / 100) * aum) : null;

    changes.push({
      plan_id: newer.plan_id,
      asset_class: newer.asset_class,
      previous_target_pct: Number(older.target_pct),
      new_target_pct: Number(newer.target_pct),
      as_of_date_previous: older.as_of_date,
      as_of_date_new: newer.as_of_date,
      implied_usd_delta: impliedUsdDelta,
    });
  }

  console.log(`Detected ${changes.length} policy change(s).`);

  let inserted = 0;
  let skipped = 0;
  for (const c of changes) {
    const { error: insErr } = await s
      .from("allocation_policy_changes")
      .upsert(c, {
        onConflict: "plan_id,asset_class,as_of_date_previous,as_of_date_new",
        ignoreDuplicates: true,
      });
    if (insErr) {
      console.warn(`  ! ${c.asset_class}@${c.plan_id.slice(0, 8)}: ${insErr.message}`);
      continue;
    }
    inserted += 1;
  }

  // Pretty-print the changes with plan names for the report.
  if (changes.length > 0) {
    const planIds = Array.from(new Set(changes.map((c) => c.plan_id)));
    const { data: plans } = await s
      .from("plans")
      .select("id, name")
      .in("id", planIds);
    const planNameById = new Map(
      (plans ?? []).map((p) => [p.id as string, p.name as string]),
    );
    console.log("\n== Detected changes ==");
    for (const c of changes) {
      const planName = planNameById.get(c.plan_id) ?? c.plan_id;
      const sign = c.new_target_pct > c.previous_target_pct ? "↑" : "↓";
      const delta = (c.new_target_pct - c.previous_target_pct).toFixed(1);
      const usdLine =
        c.implied_usd_delta != null
          ? ` (~$${(Math.abs(c.implied_usd_delta) / 1e9).toFixed(2)}B implied)`
          : "";
      console.log(
        `  ${planName.padEnd(40)} ${c.asset_class.padEnd(14)} ${c.previous_target_pct}% → ${c.new_target_pct}%  ${sign}${delta}pp${usdLine}  (${c.as_of_date_previous} → ${c.as_of_date_new})`,
      );
    }
  }

  console.log(`\nUpsert summary: inserted=${inserted} skipped=${skipped}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
