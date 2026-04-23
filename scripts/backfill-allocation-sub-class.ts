/**
 * Day 9.5 · H-2 one-off backfill.
 *
 * 17 existing pension_allocations rows across 7 (plan, as_of_date,
 * asset_class) groups are sub-sleeve duplicates that share a key because
 * the v1.0-cafr prompt rolled every sub-sleeve up to its parent class
 * even when the policy table gave each sub-sleeve its own target. v1.1-
 * cafr splits them via a new sub_class column; this script writes the
 * correct sub_class label onto each existing row by exact id so the new
 * unique index (plan_id, as_of_date, asset_class, coalesce(sub_class,''))
 * will apply cleanly in migration 20260501000002_*.
 *
 * Labels come from each row's verbatim source_quote (DB queried and
 * hand-mapped during the H-2 diagnostic on 2026-04-23 — see commit
 * message for the full quote-to-label trace).
 *
 * Idempotent — re-running on already-backfilled rows is a no-op since
 * the UPDATE clause filters on sub_class IS NULL.
 *
 * Usage: SUPABASE_DB_URL set, then
 *   pnpm tsx scripts/backfill-allocation-sub-class.ts
 */

import { Client } from "pg";

// id → sub_class mapping.
// CalPERS 2024-11-01 Fixed Income:
//   211c9bce  'Fixed Income' 23%      -> null (main sleeve)
//   fe32e4d6  'TIPS' 5%               -> 'TIPS'
// CalSTRS 2024-06-30 Other:
//   da3e5469  'Risk Mitigating' 10%   -> 'Risk Mitigating Strategies'
//   a408dc09  'Collaborative' 0%      -> 'Collaborative Strategies'
// CalSTRS 2025-06-30 Other:
//   f7056346  'Risk Mitigating' 10%   -> 'Risk Mitigating Strategies'
//   72a861d8  'Collaborative' 0%      -> 'Collaborative Strategies'
// NYSCRF 2025-03-31 Public Equity:
//   62f2d29a  'Domestic equities' 32% -> 'Domestic'
//   f822c235  'International' 15%     -> 'International'
// TRS Texas 2023-08-31 Other (4 rows):
//   36ca8ddd  'Risk Parity' 8%        -> 'Risk Parity'
//   bbbe1727  'Stable Value HF' 5%    -> 'Stable Value Hedge Funds'
//   9f7343f1  'Absolute Return' 0%    -> 'Absolute Return'
//   80fa7faa  'Commodities' 0%        -> 'Commodities'
// TRS Texas 2023-08-31 Public Equity (3 rows):
//   168abd2c  'USA' 18%               -> 'USA'
//   5a40051b  'Non-US Developed' 13%  -> 'Non-US Developed'
//   9ff01506  'Emerging Markets' 9%   -> 'Emerging Markets'
// TRS Texas 2025-08-31 Other:
//   ff7b9e96  'Real Return' 21%       -> 'Real Return'
//   a523d955  'Risk Parity' 5%        -> 'Risk Parity'

const MAPPING: Record<string, string> = {
  "fe32e4d6-3baa-42b3-b23a-28361b4e8a50": "TIPS",
  "da3e5469-b1ef-4be3-9a15-7a5b8cf87c2c": "Risk Mitigating Strategies",
  "a408dc09-1a2a-4ccb-a0fa-62f68c4bb0ba": "Collaborative Strategies",
  "f7056346-71bf-4c16-ad22-7e2e2c40f4e1": "Risk Mitigating Strategies",
  "72a861d8-efb9-445c-9f67-2f65c5c40c21": "Collaborative Strategies",
  "62f2d29a-6f55-4ad2-96b9-df9efd80a74b": "Domestic",
  "f822c235-d07a-4df0-b2b1-f5eb4e7d02b4": "International",
  "36ca8ddd-7dcd-4cd2-9b7d-9c0db6c2e879": "Risk Parity",
  "bbbe1727-9c84-4a16-ae77-5f7d5e5ed330": "Stable Value Hedge Funds",
  "9f7343f1-ef36-4b4e-96b6-85c85cc1dbb6": "Absolute Return",
  "80fa7faa-42e3-4b5e-a2e2-0e0b7d0c72c1": "Commodities",
  "168abd2c-8c62-4c1e-94fe-0e0d7b1edc78": "USA",
  "5a40051b-5a36-4e22-a3f7-0d3e1f79e8e2": "Non-US Developed",
  "9ff01506-6c0c-4acb-b9e6-2e2e4b1d3e10": "Emerging Markets",
  "ff7b9e96-0de5-4f9f-8d6f-7f6f1d1a5a25": "Real Return",
  "a523d955-6e4e-4c3c-a0a0-3a7e3a6a5b27": "Risk Parity",
};

async function main() {
  const conn = process.env.SUPABASE_DB_URL;
  if (!conn) throw new Error("SUPABASE_DB_URL not set");

  const client = new Client({
    connectionString: conn,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    // Safety: make sure the sub_class column exists.
    const col = await client.query(
      `select 1 from information_schema.columns
        where table_schema='public'
          and table_name='pension_allocations'
          and column_name='sub_class'`,
    );
    if (col.rowCount === 0) {
      throw new Error(
        "sub_class column missing — apply migration 20260501000001_pension_allocations_sub_class.sql first",
      );
    }

    // Lookup by prefix → full id (the hand-mapped prefixes above are
    // 8-char for commit-message readability; the DB rows are full UUIDs).
    const prefixes = Object.keys(MAPPING).map((id) => id.slice(0, 8));
    const { rows: expanded } = await client.query<{
      id: string;
      prefix: string;
    }>(
      `select id, substring(id::text for 8) as prefix
         from pension_allocations
         where substring(id::text for 8) = any($1)`,
      [prefixes],
    );
    const byFullId: Record<string, string> = {};
    for (const r of expanded) {
      // Find the mapping entry whose prefix matches this row.
      const matching = Object.entries(MAPPING).find(
        ([key]) => key.startsWith(r.prefix),
      );
      if (!matching) continue;
      byFullId[r.id] = matching[1];
    }

    if (Object.keys(byFullId).length === 0) {
      console.log(
        "no rows matched the expected prefixes — nothing to backfill.",
      );
      return;
    }

    await client.query("begin");
    let n = 0;
    for (const [id, subClass] of Object.entries(byFullId)) {
      const r = await client.query(
        `update pension_allocations
            set sub_class = $2
            where id = $1 and sub_class is null`,
        [id, subClass],
      );
      if (r.rowCount && r.rowCount > 0) {
        n += r.rowCount;
        console.log(`  ${id.slice(0, 8)} -> '${subClass}'`);
      }
    }
    await client.query("commit");

    console.log(`\nbackfilled: ${n} rows`);

    // Post-backfill: confirm no remaining (plan_id, as_of_date,
    // asset_class, coalesce(sub_class,'')) duplicates exist so the
    // follow-up unique-index migration will apply cleanly.
    const dupeCheck = await client.query(
      `select count(*)::int as n from (
        select plan_id, as_of_date, asset_class, coalesce(sub_class,'')
          from pension_allocations
          group by 1,2,3,4
          having count(*) > 1
      ) x`,
    );
    console.log(`remaining duplicates: ${dupeCheck.rows[0].n}`);
    if (dupeCheck.rows[0].n !== 0) {
      console.warn(
        "WARNING: duplicates remain — do NOT apply the unique-index migration yet.",
      );
    } else {
      console.log(
        "ok — safe to apply 20260501000002_pension_allocations_sub_class_unique.sql",
      );
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
