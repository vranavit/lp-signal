/**
 * Simulate the /explore Workbench's filter + stats logic against live data,
 * for 5 scenarios. Mirrors app/(dashboard)/explore/explore-workspace.tsx
 * predicates exactly so the printout matches what the page would render.
 *
 * Used during dev to confirm filter/stats behavior without taking
 * screenshots.
 */

import { Client } from "pg";

type Signal = {
  id: string;
  plan_id: string;
  fields: Record<string, unknown> | null;
  commitment_amount_usd: string | number | null;
  confidence: string | number | null;
  preliminary: boolean;
  created_at: Date;
};

function fieldStr(s: Signal, key: string): string {
  const v = (s.fields ?? {})[key];
  return typeof v === "string" ? v : "";
}
function approvalDateMs(s: Signal): number | null {
  const ad = fieldStr(s, "approval_date");
  if (!ad) return null;
  const ms = Date.parse(ad);
  return Number.isFinite(ms) ? ms : null;
}
function approvalTypeKey(s: Signal): string {
  const t = fieldStr(s, "approval_type");
  return t || "(other)";
}
function fmtUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 10_000_000) return `$${Math.round(n / 1_000_000)}M`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

type Filters = {
  assetClasses: string[];
  planIds: string[];
  approvalTypes: string[];
  timePreset: "30d" | "60d" | "6mo" | "12mo" | "all" | "custom";
  fromDate?: string | null;
  toDate?: string | null;
  minAmount: number;
  maxAmount: number;
  query: string;
};

function presetCutoff(preset: Filters["timePreset"], fromDate?: string | null) {
  const now = Date.now();
  const day = 86_400_000;
  switch (preset) {
    case "30d": return { from: now - 30 * day, to: null as number | null };
    case "60d": return { from: now - 60 * day, to: null as number | null };
    case "6mo": return { from: now - 182 * day, to: null as number | null };
    case "12mo": return { from: now - 365 * day, to: null as number | null };
    case "custom": return { from: fromDate ? Date.parse(fromDate) : null, to: null as number | null };
    default: return { from: null as number | null, to: null as number | null };
  }
}

function applyFilters(rows: Signal[], f: Filters): Signal[] {
  const cutoff = presetCutoff(f.timePreset, f.fromDate);
  const q = f.query.trim().toLowerCase();
  return rows.filter((s) => {
    if (f.assetClasses.length && !f.assetClasses.includes(fieldStr(s, "asset_class"))) return false;
    if (f.planIds.length && !f.planIds.includes(s.plan_id)) return false;
    if (f.approvalTypes.length && !f.approvalTypes.includes(approvalTypeKey(s))) return false;
    if (cutoff.from !== null) {
      const ad = approvalDateMs(s);
      if (ad === null || ad < cutoff.from) return false;
    }
    const amt = Number(s.commitment_amount_usd ?? 0);
    if (f.minAmount > 0 && amt < f.minAmount) return false;
    if (f.maxAmount > 0 && amt > f.maxAmount) return false;
    if (q) {
      const gp = fieldStr(s, "gp").toLowerCase();
      const fund = fieldStr(s, "fund_name").toLowerCase();
      if (!gp.includes(q) && !fund.includes(q)) return false;
    }
    return true;
  });
}

function statsFor(rows: Signal[]) {
  let totalUsd = 0;
  const gps = new Set<string>();
  const planIds = new Set<string>();
  for (const r of rows) {
    totalUsd += Number(r.commitment_amount_usd ?? 0);
    const gp = fieldStr(r, "gp").trim();
    if (gp) gps.add(gp);
    planIds.add(r.plan_id);
  }
  return {
    commitments: rows.length,
    totalUsd,
    uniqueGps: gps.size,
    plansCovered: planIds.size,
  };
}

function topRows(rows: Signal[], planNames: Map<string, string>, n = 5) {
  const sorted = [...rows].sort((a, b) => {
    const da = approvalDateMs(a) ?? -Infinity;
    const db = approvalDateMs(b) ?? -Infinity;
    return db - da;
  });
  return sorted.slice(0, n).map((r) => ({
    plan: planNames.get(r.plan_id) ?? r.plan_id,
    date: fieldStr(r, "approval_date") || "—",
    gp: fieldStr(r, "gp"),
    fund: fieldStr(r, "fund_name"),
    amount: fmtUsd(Number(r.commitment_amount_usd ?? 0)),
    asset: fieldStr(r, "asset_class") || "—",
    type: approvalTypeKey(r),
  }));
}

async function main() {
  if (!process.env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL not set");
  const c = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  try {
    const { rows: rawRows } = await c.query<Signal>(
      "select id, plan_id, fields, commitment_amount_usd, confidence, preliminary, created_at from signals where signal_type=1 and seed_data=false and plan_id is not null",
    );
    const { rows: planRows } = await c.query<{ id: string; name: string }>(
      "select id, name from plans",
    );
    const planNameById = new Map(planRows.map((p) => [p.id, p.name]));
    console.log(`Loaded ${rawRows.length} T1 signals across ${planRows.length} plans.\n`);

    // Resolve plan IDs for MSBI + LACERA.
    const msbiId = planRows.find((p) => p.name === "Minnesota State Board of Investment")?.id ?? "";
    const laceraId = planRows.find((p) => p.name === "LACERA")?.id ?? "";

    const scenarios: Array<{ title: string; filters: Filters }> = [
      {
        title: "1. Default (last 12 months, no other filters)",
        filters: {
          assetClasses: [],
          planIds: [],
          approvalTypes: [],
          timePreset: "12mo",
          minAmount: 0,
          maxAmount: 0,
          query: "",
        },
      },
      {
        title: "2. Asset class = PE; Plans = Minnesota SBI + LACERA",
        filters: {
          assetClasses: ["PE"],
          planIds: [msbiId, laceraId].filter(Boolean),
          approvalTypes: [],
          timePreset: "12mo",
          minAmount: 0,
          maxAmount: 0,
          query: "",
        },
      },
      {
        title: "3. Min commitment $250M, no other filters",
        filters: {
          assetClasses: [],
          planIds: [],
          approvalTypes: [],
          timePreset: "12mo",
          minAmount: 250_000_000,
          maxAmount: 0,
          query: "",
        },
      },
      {
        title: "4. GP search 'blackstone'",
        filters: {
          assetClasses: [],
          planIds: [],
          approvalTypes: [],
          timePreset: "12mo",
          minAmount: 0,
          maxAmount: 0,
          query: "blackstone",
        },
      },
      {
        title: "5. Empty state: PE only + min $5B (no commitment that big)",
        filters: {
          assetClasses: ["PE"],
          planIds: [],
          approvalTypes: [],
          timePreset: "12mo",
          minAmount: 5_000_000_000,
          maxAmount: 0,
          query: "",
        },
      },
    ];

    for (const sc of scenarios) {
      console.log("=".repeat(80));
      console.log(sc.title);
      console.log("=".repeat(80));
      const filtered = applyFilters(rawRows, sc.filters);
      const s = statsFor(filtered);
      console.log(
        `Stats: Commitments=${s.commitments}  Total=${fmtUsd(s.totalUsd)}  Unique GPs=${s.uniqueGps}  Plans covered=${s.plansCovered}`,
      );
      if (filtered.length === 0) {
        // Empty-state hint: drop each filter and compute matches.
        const dropTrials: Array<{ key: keyof Filters; matches: number }> = [];
        const filterKeys: Array<keyof Filters> = [
          "assetClasses",
          "planIds",
          "approvalTypes",
          "timePreset",
          "minAmount",
          "maxAmount",
          "query",
        ];
        for (const k of filterKeys) {
          const isActive =
            (k === "timePreset" && sc.filters.timePreset !== "all") ||
            (k === "minAmount" && sc.filters.minAmount > 0) ||
            (k === "maxAmount" && sc.filters.maxAmount > 0) ||
            (k === "query" && sc.filters.query.trim().length > 0) ||
            (Array.isArray((sc.filters as Record<string, unknown>)[k]) &&
              (((sc.filters as Record<string, unknown>)[k]) as unknown[]).length > 0);
          if (!isActive) continue;
          const trial = { ...sc.filters };
          if (k === "timePreset") (trial as Filters).timePreset = "all";
          else if (k === "minAmount") trial.minAmount = 0;
          else if (k === "maxAmount") trial.maxAmount = 0;
          else if (k === "query") trial.query = "";
          else (trial as Record<string, unknown>)[k] = [];
          const m = applyFilters(rawRows, trial).length;
          dropTrials.push({ key: k, matches: m });
        }
        dropTrials.sort((a, b) => b.matches - a.matches);
        const top = dropTrials[0];
        const labels: Record<string, string> = {
          assetClasses: "Asset class",
          planIds: "Plan",
          approvalTypes: "Approval type",
          timePreset: "Time window",
          minAmount: "Commitment size",
          maxAmount: "Commitment size",
          query: "GP/Fund search",
        };
        console.log(
          `Empty state hint: "${top.matches} signals would match if you remove the ${labels[top.key]} filter."`,
        );
      } else {
        console.log(`\nTop ${Math.min(5, filtered.length)} rows (sorted by approval date desc):`);
        for (const r of topRows(filtered, planNameById, 5)) {
          console.log(
            `  ${r.plan.padEnd(40)} ${r.date.padEnd(11)} ${r.gp.slice(0, 22).padEnd(22)} ${r.fund.slice(0, 36).padEnd(36)} ${r.amount.padStart(8)} ${r.asset.padEnd(10)} ${r.type}`,
          );
        }
      }
      console.log();
    }
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
