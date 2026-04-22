/**
 * Preview / delete noise in the pending-review queue.
 *
 * Deletion rules (applies only to seed_data=false AND validated_at IS NULL):
 *   A. amount_usd = 0  (fields.amount_usd or commitment_amount_usd)
 *   B. asset_class = 'PE' AND fields.gp ILIKE '%FTSE%'
 *   C1. T1 near-dupes: same fund_name + meeting_date (keep highest conf)
 *   C2. T2 near-dupes: same (asset_class, old_target_pct, new_target_pct, meeting_date) (keep highest conf)
 *
 * Usage:
 *   pnpm tsx scripts/cleanup-pending-signals.ts            # preview
 *   pnpm tsx scripts/cleanup-pending-signals.ts --commit   # delete
 */

import { Client } from "pg";

const COMMIT = process.argv.includes("--commit");

async function main() {
  const c = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  try {
    const BASE = `s.seed_data = false and s.validated_at is null`;

    // --- A ---
    const zeroAmount = await c.query(`
      select s.id::text, s.signal_type, s.confidence,
             s.fields->>'gp' as gp,
             s.fields->>'fund_name' as fund_name,
             coalesce(s.fields->>'amount_usd', s.commitment_amount_usd::text) as amount_raw
      from public.signals s
      where ${BASE}
        and (
          (s.fields->>'amount_usd') = '0'
          or s.commitment_amount_usd = 0
        )
    `);
    console.log(`\n== A: amount_usd = 0 (${zeroAmount.rowCount}) ==`);
    for (const r of zeroAmount.rows) {
      console.log(
        `  id=${r.id.slice(0, 8)} T${r.signal_type} conf=${r.confidence} ${r.gp} / ${r.fund_name}  amount=${r.amount_raw}`,
      );
    }

    // --- B ---
    const ftsePE = await c.query(`
      select s.id::text, s.signal_type, s.confidence, s.asset_class,
             s.fields->>'gp' as gp,
             s.fields->>'fund_name' as fund_name
      from public.signals s
      where ${BASE}
        and s.asset_class = 'PE'
        and s.fields->>'gp' ilike '%FTSE%'
    `);
    console.log(`\n== B: asset_class='PE' + gp ILIKE '%FTSE%' (${ftsePE.rowCount}) ==`);
    for (const r of ftsePE.rows) {
      console.log(
        `  id=${r.id.slice(0, 8)} T${r.signal_type} conf=${r.confidence} ${r.gp} / ${r.fund_name}  asset=${r.asset_class}`,
      );
    }

    // --- C1 ---
    const t1Dups = await c.query(`
      with ranked as (
        select s.id::text, s.signal_type, s.confidence, s.priority_score,
               s.fields->>'fund_name' as fund_name,
               d.meeting_date,
               row_number() over (
                 partition by lower(trim(s.fields->>'fund_name')), d.meeting_date
                 order by s.confidence desc, s.priority_score desc, s.id
               ) as rn,
               count(*) over (
                 partition by lower(trim(s.fields->>'fund_name')), d.meeting_date
               ) as cnt
        from public.signals s
        join public.documents d on d.id = s.document_id
        where ${BASE} and s.signal_type = 1
      )
      select * from ranked where cnt > 1 order by fund_name, meeting_date, rn
    `);
    console.log(
      `\n== C1: T1 near-dupes (fund_name, meeting_date) — keep rn=1 (${t1Dups.rowCount} involved) ==`,
    );
    for (const r of t1Dups.rows) {
      console.log(
        `  rn=${r.rn} ${Number(r.rn) === 1 ? "KEEP  " : "DELETE"} id=${r.id.slice(0, 8)} "${r.fund_name}" ${r.meeting_date?.toISOString?.()?.slice(0, 10) ?? r.meeting_date} conf=${r.confidence}`,
      );
    }

    // --- C2 ---
    const t2Dups = await c.query(`
      with ranked as (
        select s.id::text, s.signal_type, s.confidence, s.priority_score,
               s.fields->>'asset_class' as ac,
               s.fields->>'old_target_pct' as opt,
               s.fields->>'new_target_pct' as npt,
               d.meeting_date,
               row_number() over (
                 partition by s.fields->>'asset_class',
                              s.fields->>'old_target_pct',
                              s.fields->>'new_target_pct',
                              d.meeting_date
                 order by s.confidence desc, s.priority_score desc, s.id
               ) as rn,
               count(*) over (
                 partition by s.fields->>'asset_class',
                              s.fields->>'old_target_pct',
                              s.fields->>'new_target_pct',
                              d.meeting_date
               ) as cnt
        from public.signals s
        join public.documents d on d.id = s.document_id
        where ${BASE} and s.signal_type = 2
      )
      select * from ranked where cnt > 1 order by ac, opt, npt, meeting_date, rn
    `);
    console.log(
      `\n== C2: T2 near-dupes (asset_class, old→new pct, meeting_date) — keep rn=1 (${t2Dups.rowCount} involved) ==`,
    );
    for (const r of t2Dups.rows) {
      console.log(
        `  rn=${r.rn} ${Number(r.rn) === 1 ? "KEEP  " : "DELETE"} id=${r.id.slice(0, 8)} ${r.ac} ${r.opt}→${r.npt} ${r.meeting_date?.toISOString?.()?.slice(0, 10) ?? r.meeting_date} conf=${r.confidence}`,
      );
    }

    const ids = new Set<string>();
    for (const r of zeroAmount.rows) ids.add(r.id);
    for (const r of ftsePE.rows) ids.add(r.id);
    for (const r of t1Dups.rows) if (Number(r.rn) > 1) ids.add(r.id);
    for (const r of t2Dups.rows) if (Number(r.rn) > 1) ids.add(r.id);

    console.log(`\n== TOTAL candidates to delete: ${ids.size} ==`);

    if (COMMIT && ids.size > 0) {
      const del = await c.query(
        `delete from public.signals where id = any($1::uuid[]) returning id`,
        [Array.from(ids)],
      );
      console.log(`\n✓ Deleted ${del.rowCount} rows.`);
    } else if (ids.size > 0) {
      console.log(`\n(preview only — pass --commit to actually delete)`);
    }
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
