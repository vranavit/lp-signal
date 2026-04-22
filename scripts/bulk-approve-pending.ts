/**
 * Bulk-approve the current pending-review queue.
 *
 * Two actions, both limited to (seed_data = false AND validated_at IS NULL):
 *   1. DELETE one known-bad row:
 *        FTSE Russell / CalPERS FTSE Climate Transition Custom Index
 *        (asset_class='Other', amount_usd=5,000,000,000, source_page=5,
 *         meeting_date=2024-11-18).
 *      Matched on source_quote ILIKE '%CalPERS FTSE Climate Transition%'
 *      plus the other field constraints for safety.
 *   2. APPROVE everything else: set validated_at = now().
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/bulk-approve-pending.ts           # preview
 *   pnpm tsx --env-file=.env.local scripts/bulk-approve-pending.ts --commit  # execute
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

    // --- 1. Preview the single row to delete ---
    const badRowSql = `
      select s.id::text, s.signal_type, s.confidence, s.asset_class,
             s.commitment_amount_usd,
             s.source_page,
             d.meeting_date,
             s.fields->>'gp' as gp,
             s.fields->>'fund_name' as fund_name,
             left(s.source_quote, 120) as source_quote_preview
      from public.signals s
      left join public.documents d on d.id = s.document_id
      where ${BASE}
        and s.source_quote ilike '%CalPERS FTSE Climate Transition%'
        and s.asset_class = 'Other'
        and s.commitment_amount_usd = 5000000000
        and s.source_page = 5
        and d.meeting_date = '2024-11-18'
    `;
    const bad = await c.query(badRowSql);
    console.log(`\n== 1. DELETE target (${bad.rowCount}) ==`);
    for (const r of bad.rows) {
      console.log(
        `  id=${r.id.slice(0, 8)} T${r.signal_type} conf=${r.confidence} ${r.asset_class} $${Number(r.commitment_amount_usd).toLocaleString()} p${r.source_page} ${r.meeting_date?.toISOString?.()?.slice(0, 10) ?? r.meeting_date}`,
      );
      console.log(`      gp=${r.gp} / fund=${r.fund_name}`);
      console.log(`      quote="${r.source_quote_preview}..."`);
    }
    if (bad.rowCount !== 1) {
      console.log(
        `\n⚠ expected exactly 1 match, got ${bad.rowCount}. Aborting before any write.`,
      );
      return;
    }
    const badId = bad.rows[0].id as string;

    // --- 2. Preview everything else that would be approved ---
    const toApprove = await c.query(
      `
      select s.id::text, s.signal_type, s.confidence, s.priority_score,
             s.asset_class,
             s.fields->>'gp' as gp,
             s.fields->>'fund_name' as fund_name,
             d.meeting_date
      from public.signals s
      left join public.documents d on d.id = s.document_id
      where ${BASE}
        and s.id <> $1::uuid
      order by s.priority_score desc, s.confidence desc
    `,
      [badId],
    );
    console.log(`\n== 2. APPROVE (validated_at = now()) — ${toApprove.rowCount} rows ==`);
    for (const r of toApprove.rows) {
      console.log(
        `  id=${r.id.slice(0, 8)} T${r.signal_type} p=${r.priority_score} conf=${r.confidence} ${r.asset_class ?? "-"}  ${r.gp ?? "-"} / ${r.fund_name ?? "-"}  ${r.meeting_date?.toISOString?.()?.slice(0, 10) ?? "-"}`,
      );
    }

    console.log(
      `\nSummary: 1 delete, ${toApprove.rowCount} approvals.  ${COMMIT ? "(committing)" : "(preview only — pass --commit to execute)"}`,
    );

    if (!COMMIT) return;

    await c.query("begin");
    try {
      const del = await c.query(
        `delete from public.signals where id = $1::uuid returning id`,
        [badId],
      );
      const upd = await c.query(
        `update public.signals
            set validated_at = now()
          where validated_at is null and seed_data = false
          returning id`,
      );
      await c.query("commit");
      console.log(
        `\n✓ Deleted ${del.rowCount}.  ✓ Approved ${upd.rowCount}.`,
      );

      const totals = await c.query(`
        select
          count(*)::int                                                as total,
          count(*) filter (where validated_at is not null)::int        as validated,
          count(*) filter (where seed_data = true)::int                as seed,
          count(*) filter (where validated_at is null
                           and seed_data = false)::int                 as still_pending,
          count(*) filter (where validated_at is not null
                           or  seed_data = true)::int                  as dashboard_visible
        from public.signals
      `);
      const t = totals.rows[0];
      console.log(
        `\nPost-commit counts: total=${t.total} validated=${t.validated} seed=${t.seed} still_pending=${t.still_pending} dashboard_visible=${t.dashboard_visible}`,
      );
    } catch (e) {
      await c.query("rollback");
      throw e;
    }
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
