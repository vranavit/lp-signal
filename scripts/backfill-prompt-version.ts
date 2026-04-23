/**
 * Day 9.5 · H-4 one-off backfill.
 *
 * 18 signals were inserted before the classifier had a stable
 * `prompt_version` column wiring, leaving the column NULL. This script
 * backfills those rows with the historically-correct value:
 *
 *   - seed_data = true           → prompt_version = 'seed'  (3 rows)
 *   - seed_data = false, created < 2026-04-22T01:06:49Z
 *                                → prompt_version = 'v2.0'  (15 rows)
 *
 * Timestamp boundaries come from git log on lib/classifier/prompt.ts:
 *   14aad91 2026-04-21T20:38 UTC  Phase 2 classifier with DOA scope (v2.0)
 *   8489aca 2026-04-22T01:06 UTC  Confidence-tiered auto-approval (v2.1)
 *
 * All 15 non-seed NULL rows fall inside the v2.0 window.
 *
 * Idempotent — re-running on a fully-backfilled table is a no-op.
 *
 * Usage: SUPABASE_DB_URL set, then `pnpm tsx scripts/backfill-prompt-version.ts`
 */

import { Client } from "pg";

async function main() {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) throw new Error("SUPABASE_DB_URL not set");

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    await client.query("begin");

    const seedRes = await client.query(
      `update signals
         set prompt_version = 'seed'
       where prompt_version is null
         and seed_data = true`,
    );

    const v20Res = await client.query(
      `update signals
         set prompt_version = 'v2.0'
       where prompt_version is null
         and seed_data = false`,
    );

    const remaining = await client.query(
      `select count(*)::int as n from signals where prompt_version is null`,
    );
    if (remaining.rows[0].n !== 0) {
      throw new Error(
        `backfill incomplete — ${remaining.rows[0].n} rows still NULL`,
      );
    }

    await client.query("commit");

    console.log(`seed rows backfilled: ${seedRes.rowCount}`);
    console.log(`v2.0 rows backfilled: ${v20Res.rowCount}`);

    const dist = await client.query(
      `select coalesce(prompt_version, 'NULL') as v, count(*)::int as n
         from signals
         group by 1
         order by n desc`,
    );
    console.log("\ndistribution after backfill:");
    for (const row of dist.rows) {
      console.log(`  ${String(row.v).padEnd(14)} ${row.n}`);
    }
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
