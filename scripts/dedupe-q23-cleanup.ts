/**
 * Phase 3 Step 5 of the dedupe sprint: apply Q2 + Q3 near-duplicate
 * decisions from docs/audits/dedupe-near-dupes-2026-04-26.md.
 *
 * Decision shapes supported (parsed from the YAML block in the doc):
 *   decision: keep_distinct                  -> no rows touched
 *   decision: merge, canonical: K            -> merge ALL variants to variant K
 *   decision: merge, canonical: K, merge:[..]-> partial: only listed variants merged
 *
 * Algorithm per merge case:
 *   1. Recompute the case from current DB state (Q2 keys on plan+gp+amount;
 *      Q3 keys on plan+fund_name+amount).
 *   2. Identify the merge_set: variants to collapse (default all; partial uses
 *      `merge` list).
 *   3. Pull all rows whose fund_name (Q2) or gp (Q3) is in the merge_set.
 *   4. Pick the canonical-string winner row: highest confidence, then earliest
 *      created_at, then lowest UUID. Filtered to rows already matching the
 *      canonical variant if any exist; otherwise the highest-conf row of the
 *      whole merge_set wins and gets its name updated.
 *   5. Update the canonical row's fund_name/gp to the canonical variant string
 *      (no-op if already correct).
 *   6. For each other row in the merge_set: if its (plan, gp, fund_name,
 *      amount, approval_date) tuple post-update would collide with the canonical
 *      row's tuple, delete it. Otherwise update its fund_name/gp to canonical
 *      and keep it (different approval_date -> distinct fact).
 *
 * All operations run inside one BEGIN/COMMIT. Rollback on any unexpected
 * post-flight count or any per-case error.
 *
 * Usage:
 *   pnpm tsx scripts/dedupe-q23-cleanup.ts          # dry-run
 *   pnpm tsx scripts/dedupe-q23-cleanup.ts --apply  # commit
 */

import { Client } from "pg";
import fs from "node:fs";

const DOC_PATH = "/Users/vitekvrana/Desktop/lp-signal/docs/audits/dedupe-near-dupes-2026-04-26.md";

type Decision =
  | { kind: "keep_distinct" }
  | { kind: "merge"; canonical: number; mergeIdx?: number[] };

type Signal = {
  id: string;
  plan_id: string;
  fields: Record<string, unknown> | null;
  commitment_amount_usd: string | number | null;
  confidence: string | number | null;
  prompt_version: string | null;
  document_id: string | null;
  created_at: Date | string;
};

function gpOf(s: Signal): string {
  const v = (s.fields ?? {})["gp"];
  return typeof v === "string" ? v : "";
}
function fundOf(s: Signal): string {
  const v = (s.fields ?? {})["fund_name"];
  return typeof v === "string" ? v : "";
}
function approvalOf(s: Signal): string {
  const v = (s.fields ?? {})["approval_date"];
  return typeof v === "string" ? v : "";
}
function timeOf(s: Signal): number {
  return s.created_at instanceof Date ? s.created_at.getTime() : Date.parse(String(s.created_at));
}
function confOf(s: Signal): number {
  return Number(s.confidence ?? 0);
}

// ── Minimal YAML parser for our specific shape.
function parseDecisions(yamlText: string): Map<string, Decision> {
  const out = new Map<string, Decision>();
  const lines = yamlText.split("\n");
  let currentId: string | null = null;
  let currentDecision: string | null = null;
  let currentCanonical: number | null = null;
  let currentMerge: number[] | null = null;
  const flush = () => {
    if (!currentId) return;
    if (currentDecision === "keep_distinct") {
      out.set(currentId, { kind: "keep_distinct" });
    } else if (currentDecision === "merge") {
      if (currentCanonical == null) {
        throw new Error(`${currentId}: merge without canonical`);
      }
      out.set(currentId, {
        kind: "merge",
        canonical: currentCanonical,
        mergeIdx: currentMerge ?? undefined,
      });
    }
    currentId = null;
    currentDecision = null;
    currentCanonical = null;
    currentMerge = null;
  };

  for (const raw of lines) {
    // Strip comments at end of line (avoid eating # inside quotes; simple split is fine for our format).
    const line = raw.replace(/\s+#.*$/, "");
    const idMatch = line.match(/^(Q[23]-\d{3}):\s*$/);
    if (idMatch) {
      flush();
      currentId = idMatch[1];
      continue;
    }
    if (!currentId) continue;
    const decMatch = line.match(/^\s*decision:\s*(merge|keep_distinct)\s*$/);
    if (decMatch) {
      currentDecision = decMatch[1];
      continue;
    }
    const canMatch = line.match(/^\s*canonical:\s*(\d+)\s*$/);
    if (canMatch) {
      currentCanonical = parseInt(canMatch[1], 10);
      continue;
    }
    const mergeMatch = line.match(/^\s*merge:\s*\[([\d,\s]+)\]\s*$/);
    if (mergeMatch) {
      currentMerge = mergeMatch[1].split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n));
      continue;
    }
  }
  flush();
  return out;
}

function chooseWinner(rows: Signal[]): Signal {
  return [...rows].sort((a, b) => {
    const ca = confOf(a);
    const cb = confOf(b);
    if (ca !== cb) return cb - ca;
    const ta = timeOf(a);
    const tb = timeOf(b);
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  })[0];
}

async function main() {
  const apply = process.argv.includes("--apply");
  if (!process.env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL not set");

  const docText = fs.readFileSync(DOC_PATH, "utf8");
  const yamlMatch = docText.match(/```yaml\n([\s\S]*?)\n```/);
  if (!yamlMatch) throw new Error("no ```yaml block found in doc");
  const decisions = parseDecisions(yamlMatch[1]);
  console.log(`parsed decisions: ${decisions.size}`);

  const c = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  try {
    await c.query("BEGIN");

    // Pre-flight: T1 count.
    const { rows: pre } = await c.query<{ n: number }>(
      "select count(*)::int as n from signals where signal_type = 1",
    );
    const preCount = Number(pre[0]?.n ?? 0);
    console.log(`[pre-flight] T1 signals: ${preCount}`);

    // Pull all T1 signals.
    const { rows: signals } = await c.query<Signal>(
      "select id, plan_id, fields, commitment_amount_usd, confidence, prompt_version, document_id, created_at from signals where signal_type = 1",
    );

    // Build Q2 cases (same plan+gp+amount).
    type Q2Case = {
      id: string;
      plan_id: string;
      gp: string;
      amount: number | null;
      variants: string[];
      variantsToRows: Map<string, Signal[]>;
    };
    const q2Map = new Map<string, Q2Case>();
    for (const s of signals) {
      const amt = s.commitment_amount_usd == null ? null : Number(s.commitment_amount_usd);
      const key = [s.plan_id, gpOf(s), amt ?? "null"].join("|");
      let g = q2Map.get(key);
      if (!g) {
        g = {
          id: "",
          plan_id: s.plan_id,
          gp: gpOf(s),
          amount: amt,
          variants: [],
          variantsToRows: new Map(),
        };
        q2Map.set(key, g);
      }
      const fn = fundOf(s);
      if (!g.variantsToRows.has(fn)) {
        g.variantsToRows.set(fn, []);
        g.variants.push(fn);
      }
      g.variantsToRows.get(fn)!.push(s);
    }
    const q2Cases = Array.from(q2Map.values())
      .filter((g) => g.variantsToRows.size > 1)
      .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
    q2Cases.forEach((g, i) => (g.id = `Q2-${String(i + 1).padStart(3, "0")}`));

    // Build Q3 cases (same plan+fund+amount).
    type Q3Case = {
      id: string;
      plan_id: string;
      fund: string;
      amount: number | null;
      variants: string[];
      variantsToRows: Map<string, Signal[]>;
    };
    const q3Map = new Map<string, Q3Case>();
    for (const s of signals) {
      const amt = s.commitment_amount_usd == null ? null : Number(s.commitment_amount_usd);
      const key = [s.plan_id, fundOf(s), amt ?? "null"].join("|");
      let g = q3Map.get(key);
      if (!g) {
        g = {
          id: "",
          plan_id: s.plan_id,
          fund: fundOf(s),
          amount: amt,
          variants: [],
          variantsToRows: new Map(),
        };
        q3Map.set(key, g);
      }
      const gp = gpOf(s);
      if (!g.variantsToRows.has(gp)) {
        g.variantsToRows.set(gp, []);
        g.variants.push(gp);
      }
      g.variantsToRows.get(gp)!.push(s);
    }
    const q3Cases = Array.from(q3Map.values())
      .filter((g) => g.variantsToRows.size > 1)
      .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
    q3Cases.forEach((g, i) => (g.id = `Q3-${String(i + 1).padStart(3, "0")}`));

    if (q2Cases.length !== 40 || q3Cases.length !== 32) {
      throw new Error(
        `case-count mismatch vs doc: Q2=${q2Cases.length} (expected 40), Q3=${q3Cases.length} (expected 32)`,
      );
    }

    // Apply each case.
    let totalUpdated = 0;
    let totalDeleted = 0;
    let casesApplied = 0;
    let casesSkipped = 0;

    type Op =
      | { caseId: string; kind: "update"; rowId: string; field: "fund_name" | "gp"; from: string; to: string }
      | { caseId: string; kind: "delete"; rowId: string; reason: string };
    const plannedOps: Op[] = [];

    async function applyMerge<T extends Q2Case | Q3Case>(
      g: T,
      d: Decision & { kind: "merge" },
      isQ3: boolean,
    ) {
      const fieldName: "fund_name" | "gp" = isQ3 ? "gp" : "fund_name";
      const variantList = g.variants;
      if (d.canonical < 1 || d.canonical > variantList.length) {
        throw new Error(`${g.id}: canonical ${d.canonical} out of range (variants=${variantList.length})`);
      }
      const canonicalString = variantList[d.canonical - 1];

      // mergeIdx defaults to all variant indexes 1..N.
      const mergeIdx = d.mergeIdx ?? variantList.map((_, i) => i + 1);
      // canonical must be in mergeIdx; if not, that's a malformed decision.
      if (!mergeIdx.includes(d.canonical)) {
        throw new Error(`${g.id}: partial merge but canonical ${d.canonical} not in merge list ${JSON.stringify(mergeIdx)}`);
      }

      const variantsToMerge = mergeIdx.map((i) => variantList[i - 1]);
      const rowsInMergeSet: Signal[] = [];
      for (const v of variantsToMerge) rowsInMergeSet.push(...(g.variantsToRows.get(v) ?? []));
      if (rowsInMergeSet.length === 0) {
        casesSkipped++;
        return;
      }

      // Group rows in merge_set by approval_date so we never collapse across
      // distinct approval dates (those are genuinely different facts).
      const byApproval = new Map<string, Signal[]>();
      for (const r of rowsInMergeSet) {
        const k = approvalOf(r) || "__null__";
        if (!byApproval.has(k)) byApproval.set(k, []);
        byApproval.get(k)!.push(r);
      }

      for (const [, rowsAtSameApproval] of byApproval) {
        // Pick the row whose current value already matches canonicalString if any;
        // otherwise pick the tiebreak winner.
        const alreadyCanonical = rowsAtSameApproval.filter(
          (r) => (isQ3 ? gpOf(r) : fundOf(r)) === canonicalString,
        );
        const winner = alreadyCanonical.length > 0
          ? chooseWinner(alreadyCanonical)
          : chooseWinner(rowsAtSameApproval);

        // Update winner's field if needed.
        const winnerCurrent = isQ3 ? gpOf(winner) : fundOf(winner);
        if (winnerCurrent !== canonicalString) {
          plannedOps.push({
            caseId: g.id,
            kind: "update",
            rowId: winner.id,
            field: fieldName,
            from: winnerCurrent,
            to: canonicalString,
          });
        }
        // Delete the rest at this approval date.
        for (const r of rowsAtSameApproval) {
          if (r.id === winner.id) continue;
          plannedOps.push({
            caseId: g.id,
            kind: "delete",
            rowId: r.id,
            reason: `merge to ${g.id} canonical "${canonicalString}" at approval=${approvalOf(r) || "—"}`,
          });
        }
      }
      casesApplied++;
    }

    for (const g of q2Cases) {
      const d = decisions.get(g.id);
      if (!d) {
        console.warn(`no decision for ${g.id}; skipping`);
        casesSkipped++;
        continue;
      }
      if (d.kind === "keep_distinct") {
        casesSkipped++;
        continue;
      }
      await applyMerge(g, d, false);
    }
    for (const g of q3Cases) {
      const d = decisions.get(g.id);
      if (!d) {
        console.warn(`no decision for ${g.id}; skipping`);
        casesSkipped++;
        continue;
      }
      if (d.kind === "keep_distinct") {
        casesSkipped++;
        continue;
      }
      await applyMerge(g, d, true);
    }

    const planUpdates = plannedOps.filter((o) => o.kind === "update").length;
    const planDeletes = plannedOps.filter((o) => o.kind === "delete").length;
    console.log(`[plan] cases applied: ${casesApplied}, cases skipped (keep_distinct or no-op): ${casesSkipped}`);
    console.log(`[plan] field updates: ${planUpdates}`);
    console.log(`[plan] deletions: ${planDeletes}`);

    // Print top deletions by case for visibility.
    const byCase = new Map<string, { updates: number; deletes: number }>();
    for (const op of plannedOps) {
      const cur = byCase.get(op.caseId) ?? { updates: 0, deletes: 0 };
      if (op.kind === "update") cur.updates++;
      else cur.deletes++;
      byCase.set(op.caseId, cur);
    }
    console.log(`\n[per-case ops]`);
    for (const [caseId, counts] of Array.from(byCase.entries()).sort()) {
      console.log(`  ${caseId}: updates=${counts.updates} deletes=${counts.deletes}`);
    }

    if (!apply) {
      console.log(`\n[dry-run] no DB writes performed. Re-run with --apply to commit.`);
      await c.query("ROLLBACK");
      return;
    }

    // Apply: do all updates first, then all deletes. Inside one transaction.
    for (const op of plannedOps) {
      if (op.kind === "update") {
        const sql =
          op.field === "fund_name"
            ? "update signals set fields = jsonb_set(fields, '{fund_name}', to_jsonb($2::text)) where id = $1"
            : "update signals set fields = jsonb_set(fields, '{gp}', to_jsonb($2::text)) where id = $1";
        const r = await c.query(sql, [op.rowId, op.to]);
        if (r.rowCount !== 1) {
          throw new Error(`update ${op.rowId} affected ${r.rowCount} rows (expected 1)`);
        }
        totalUpdated++;
      } else {
        const r = await c.query("delete from signals where id = $1", [op.rowId]);
        if (r.rowCount !== 1) {
          throw new Error(`delete ${op.rowId} affected ${r.rowCount} rows (expected 1)`);
        }
        totalDeleted++;
      }
    }

    // Post-flight: confirm new T1 count.
    const expectedFinal = preCount - planDeletes;
    const { rows: post } = await c.query<{ n: number }>(
      "select count(*)::int as n from signals where signal_type = 1",
    );
    const postCount = Number(post[0]?.n ?? 0);
    console.log(`[post-flight] T1 signals: ${postCount} (expected ${expectedFinal})`);
    if (postCount !== expectedFinal) {
      throw new Error(`post-flight count mismatch: got ${postCount}, expected ${expectedFinal}`);
    }

    // Sanity: no remaining duplicate natural keys among updated cases.
    const { rows: remDups } = await c.query<{ n: number }>(
      `select count(*)::int as n from (
         select 1
         from signals
         where signal_type = 1
         group by plan_id,
                  fields->>'gp',
                  fields->>'fund_name',
                  commitment_amount_usd,
                  fields->>'approval_date'
         having count(*) > 1
       ) t`,
    );
    const remainingDupGroups = Number(remDups[0]?.n ?? 0);
    console.log(`[post-flight] remaining duplicate natural-key groups: ${remainingDupGroups}`);

    await c.query("COMMIT");
    console.log(
      `\n[committed] applied ${casesApplied} merge cases. Updated: ${totalUpdated}. Deleted: ${totalDeleted}. Final T1 count: ${postCount}.`,
    );
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
