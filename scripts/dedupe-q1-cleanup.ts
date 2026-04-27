/**
 * Phase 3 Step 1 of the dedupe sprint: hard-delete Q1 exact duplicates.
 *
 * Tiebreak rules per row group (group key = plan_id, gp, fund_name,
 * commitment_amount_usd, approval_date):
 *   1. Highest confidence wins.
 *   2. If tied on confidence, earliest created_at.
 *   3. If still tied, lowest UUID (deterministic).
 *
 * Atomicity: BEGIN ... COMMIT in pg. Pre-flight count guard: total T1 must
 * equal 479; deletable count must equal 116. Post-flight: rows_deleted must
 * equal 116, new T1 count must equal 363. ROLLBACK on any mismatch.
 *
 * Reports tiebreak stats: how many groups resolved by confidence vs by
 * created_at vs by UUID.
 *
 * Usage:
 *   pnpm tsx scripts/dedupe-q1-cleanup.ts          # dry-run
 *   pnpm tsx scripts/dedupe-q1-cleanup.ts --apply  # commit
 */

import { Client } from "pg";

type Signal = {
  id: string;
  plan_id: string;
  signal_type: number;
  fields: Record<string, unknown> | null;
  commitment_amount_usd: string | number | null;
  confidence: string | number | null;
  created_at: string;
};

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

const EXPECTED_TOTAL_T1 = 479;
const EXPECTED_DELETIONS = 116;
const EXPECTED_FINAL_T1 = EXPECTED_TOTAL_T1 - EXPECTED_DELETIONS;

async function main() {
  const apply = process.argv.includes("--apply");
  if (!process.env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL not set");

  const c = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();

  try {
    await c.query("BEGIN");

    // ── Pre-flight: load all T1 signals.
    const { rows } = await c.query<Signal>(
      "select id, plan_id, signal_type, fields, commitment_amount_usd, confidence, created_at from signals where signal_type = 1",
    );
    const total = rows.length;
    console.log(`[pre-flight] T1 signals total: ${total} (expected ${EXPECTED_TOTAL_T1})`);
    if (total !== EXPECTED_TOTAL_T1) {
      throw new Error(`pre-flight count mismatch: got ${total}, expected ${EXPECTED_TOTAL_T1}`);
    }

    // ── Group by natural key.
    type Group = {
      key: string;
      rows: Signal[];
    };
    const groupMap = new Map<string, Group>();
    for (const s of rows) {
      const key = [
        s.plan_id,
        gpOf(s),
        fundOf(s),
        s.commitment_amount_usd ?? "null",
        approvalOf(s),
      ].join("");
      let g = groupMap.get(key);
      if (!g) {
        g = { key, rows: [] };
        groupMap.set(key, g);
      }
      g.rows.push(s);
    }
    const dupGroups = Array.from(groupMap.values()).filter((g) => g.rows.length > 1);
    console.log(`[pre-flight] duplicate groups: ${dupGroups.length}`);
    const extras = dupGroups.reduce((n, g) => n + (g.rows.length - 1), 0);
    console.log(`[pre-flight] deletable extras: ${extras} (expected ${EXPECTED_DELETIONS})`);
    if (extras !== EXPECTED_DELETIONS) {
      throw new Error(`pre-flight deletion count mismatch: got ${extras}, expected ${EXPECTED_DELETIONS}`);
    }

    // ── Tiebreak per group, collect IDs to delete + tiebreak stats.
    let resolvedByConfidence = 0;
    let resolvedByCreatedAt = 0;
    let resolvedByUuid = 0;
    const idsToDelete: string[] = [];
    const keptIds: string[] = [];

    for (const g of dupGroups) {
      // Sort by tiebreak rules.
      const sorted = [...g.rows].sort((a, b) => {
        const ca = Number(a.confidence ?? 0);
        const cb = Number(b.confidence ?? 0);
        if (ca !== cb) return cb - ca; // higher confidence first
        const ta = Date.parse(a.created_at);
        const tb = Date.parse(b.created_at);
        if (ta !== tb) return ta - tb; // earlier first
        return a.id.localeCompare(b.id); // lower UUID first
      });
      const winner = sorted[0];
      const losers = sorted.slice(1);
      keptIds.push(winner.id);
      for (const l of losers) idsToDelete.push(l.id);

      // Classify how the winner was chosen.
      const winnerConf = Number(winner.confidence ?? 0);
      const allSameConf = g.rows.every((r) => Number(r.confidence ?? 0) === winnerConf);
      if (!allSameConf) {
        resolvedByConfidence++;
      } else {
        const winnerTime = Date.parse(winner.created_at);
        const allSameTime = g.rows.every((r) => Date.parse(r.created_at) === winnerTime);
        if (!allSameTime) {
          resolvedByCreatedAt++;
        } else {
          resolvedByUuid++;
        }
      }
    }

    console.log(`[tiebreak stats]`);
    console.log(`  resolved by confidence (winner had strictly higher conf): ${resolvedByConfidence}`);
    console.log(`  resolved by created_at (all tied on conf, winner was earliest): ${resolvedByCreatedAt}`);
    console.log(`  resolved by UUID (all tied on conf AND created_at): ${resolvedByUuid}`);
    console.log(`  total groups: ${dupGroups.length} (= ${resolvedByConfidence + resolvedByCreatedAt + resolvedByUuid})`);

    if (idsToDelete.length !== EXPECTED_DELETIONS) {
      throw new Error(`computed delete list mismatch: got ${idsToDelete.length}, expected ${EXPECTED_DELETIONS}`);
    }
    // Sanity: no overlap between kept and deleted.
    const keptSet = new Set(keptIds);
    for (const id of idsToDelete) {
      if (keptSet.has(id)) throw new Error(`overlap between keep and delete sets on id ${id}`);
    }

    // ── Verify each kept id still resolves to a row whose natural key
    // matches the group's natural key (defensive).
    // Skipped: implicit by construction. Move on to deletion.

    if (!apply) {
      console.log(`\n[dry-run] would delete ${idsToDelete.length} rows. Re-run with --apply to commit.`);
      await c.query("ROLLBACK");
      return;
    }

    // ── Delete in a single statement inside the transaction.
    const delResult = await c.query(
      "delete from signals where id = ANY($1::uuid[])",
      [idsToDelete],
    );
    const rowsDeleted = delResult.rowCount ?? 0;
    console.log(`[delete] rows_deleted: ${rowsDeleted} (expected ${EXPECTED_DELETIONS})`);
    if (rowsDeleted !== EXPECTED_DELETIONS) {
      throw new Error(`post-delete count mismatch: rows_deleted=${rowsDeleted}, expected=${EXPECTED_DELETIONS}`);
    }

    // ── Post-flight: confirm new T1 total.
    const { rows: postRows } = await c.query<{ n: string }>(
      "select count(*)::int as n from signals where signal_type = 1",
    );
    const newTotal = Number(postRows[0]?.n ?? 0);
    console.log(`[post-flight] T1 signals total: ${newTotal} (expected ${EXPECTED_FINAL_T1})`);
    if (newTotal !== EXPECTED_FINAL_T1) {
      throw new Error(`post-flight count mismatch: got ${newTotal}, expected ${EXPECTED_FINAL_T1}`);
    }

    // ── Post-flight: confirm zero remaining Q1 dupes by re-running the
    // group check inside the transaction.
    const { rows: postRows2 } = await c.query<Signal>(
      "select id, plan_id, signal_type, fields, commitment_amount_usd, confidence, created_at from signals where signal_type = 1",
    );
    const postGroupMap = new Map<string, number>();
    for (const s of postRows2) {
      const key = [
        s.plan_id,
        gpOf(s),
        fundOf(s),
        s.commitment_amount_usd ?? "null",
        approvalOf(s),
      ].join("");
      postGroupMap.set(key, (postGroupMap.get(key) ?? 0) + 1);
    }
    const remainingDupGroups = Array.from(postGroupMap.values()).filter((n) => n > 1).length;
    console.log(`[post-flight] remaining Q1 dup groups: ${remainingDupGroups} (expected 0)`);
    if (remainingDupGroups !== 0) {
      throw new Error(`post-flight has ${remainingDupGroups} remaining Q1 dup groups`);
    }

    await c.query("COMMIT");
    console.log(`\n[committed] deleted ${rowsDeleted} Q1 duplicate rows. Final T1 count: ${newTotal}.`);
  } catch (e) {
    await c.query("ROLLBACK");
    console.error(`[rolled back] ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
