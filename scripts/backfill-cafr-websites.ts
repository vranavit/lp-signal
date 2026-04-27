/**
 * PR 1 of sub-project B (CAFR auto-ingestion).
 *
 * One-shot backfill of `plans.scrape_config.website` for the 13 plans that
 * currently lack a CAFR landing-page URL. Also sets `manual_only: true` on
 * the 4 plans whose CAFRs cannot or should not be auto-ingested:
 *
 *   Florida SBA   - Akamai bot wall blocks automated fetch
 *   TRS Texas     - Akamai bot wall blocks automated fetch
 *   Wisconsin SWIB- annual report is target-only by source design
 *   Colorado PERA - already has website set; flip manual_only to true
 *
 * The weekly /api/cron/scrape-cafr heartbeat will skip plans where
 * scrape_config.manual_only=true so they don't pollute the alert digest
 * with permanent failures.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-cafr-websites.ts          # dry-run (probe + report)
 *   pnpm tsx scripts/backfill-cafr-websites.ts --apply  # commit changes
 *
 * Probe semantics: HEAD/GET each URL with the same Chrome-like headers the
 * heartbeat uses. Report HTTP status + content-type. Apply step writes
 * scrape_config updates inside one BEGIN/COMMIT with pre/post count guards.
 *
 * The probe never blocks the apply step - even when a probe fails (e.g.
 * Akamai 403) we still write the website + manual_only flag, because the
 * presence of the URL is the canonical "manual fallback target" the
 * scripts/scrape-cafr-*.ts runners point at.
 */

import { Client } from "pg";
import { fetchWithDefaults } from "@/lib/scrapers/http";

type Target = {
  planName: string;
  website: string;
  manualOnly: boolean;
  manualOnlyReason?: string;
  // True when this plan already has a website set in scrape_config and we
  // only need to flip manual_only. We probe and update either way.
  hasExistingWebsite?: boolean;
};

// URLs verified by web search 2026-04-27. Notes per plan:
//   - CalPERS: chose /investments/about-investment-office/investment-financial-reports
//     since it's the official Investment Office reports landing page that
//     lists every CAFR. The /about/transparency/financial-reports URL I
//     proposed in PR 1 v1 was a 404.
//   - Michigan SMRS: ORS umbrella ACFR archive at /ors/acfr lists every
//     state retirement system ACFR (MSERS / MPSERS / SPRS). MSMRS = State
//     Michigan Retirement Systems is the holding pool; the ACFRs we actually
//     ingest are MPSERS or SERS. /ors/acfr is the canonical index for both.
//   - NYSCRF (NYSLRS-dedicated CAFR): /retirement/about-nyslrs is the
//     official NYSLRS hub page. Per-year ACFR pages live at
//     /retirement/resources/{YYYY}-nyslrs-annual-comprehensive-financial-report.
//     Hashing the hub catches "new ACFR linked".
//   - NYSTRS: Annual Reports archive page lists every ACFR + PAFR.
//     The /About-Us/* path I tried in v1 was bot-blocked; library/publications
//     path appears not to be.
//   - PA PSERS: /agencies/psers/transparency/financial-reports.html is the
//     correct canonical path; my v1 used /en/agencies/... which doesn't
//     exist.
//   - TRS Illinois: /financial/acfrs is the dedicated ACFR archive (vs
//     /financial/financial-reports which I had wrong; that one 404s).
//   - Florida SBA: Annual Investment Reports archive at /reporting/
//     annual-investment-reports/ replaces the /fsb/Investments/AnnualReports
//     path I had. Akamai-blocked anyway, but this URL is at least the
//     correct manual fallback target.
const TARGETS: Target[] = [
  // ── 10 plans needing website backfill, auto-ingest enabled ───────────
  { planName: "CalPERS", website: "https://www.calpers.ca.gov/investments/about-investment-office/investment-financial-reports", manualOnly: false },
  { planName: "CalSTRS", website: "https://www.calstrs.com/financial-statements", manualOnly: false },
  { planName: "Michigan SMRS", website: "https://www.michigan.gov/ors/acfr", manualOnly: false },
  { planName: "New York State Common Retirement Fund", website: "https://www.osc.ny.gov/retirement/about-nyslrs", manualOnly: false },
  { planName: "North Carolina Retirement Systems", website: "https://www.nctreasurer.gov/divisions/investment-management", manualOnly: false },
  // NYSTRS dropped to manual_only after PR 1 dry-run probe: nystrs.org
  // bot-blocks HTML page fetches with HTTP 403 even using fetchWithDefaults'
  // Chrome-like UA + Sec-Fetch headers. Both candidate index URLs
  // (/About-Us/Annual-Comprehensive-Financial-Report and
  // /library/publications/annual-reports/) returned 403. The existing
  // lib/scrapers/nystrs.ts works because it fetches a single stable
  // PE_Commitments.pdf binary URL (not HTML) - that path is open. CAFR
  // landing-page heartbeat fundamentally cannot work for this plan.
  // Manual fallback: scripts/scrape-cafr-nystrs.ts with the year-encoded
  // PDF URL hardcoded.
  { planName: "Ohio PERS", website: "https://www.opers.org/financial/reports.shtml", manualOnly: false },
  { planName: "PA PSERS", website: "https://www.pa.gov/agencies/psers/transparency/financial-reports.html", manualOnly: false },
  { planName: "TRS Illinois", website: "https://www.trsil.org/financial/acfrs", manualOnly: false },
  { planName: "Washington State Investment Board", website: "https://www.sib.wa.gov/reports.html", manualOnly: false },

  // ── 3 plans needing website backfill AND manual_only=true ────────────
  { planName: "Florida SBA", website: "https://www.sbafla.com/reporting/annual-investment-reports/", manualOnly: true, manualOnlyReason: "Akamai bot wall blocks automated fetch" },
  { planName: "Teacher Retirement System of Texas", website: "https://www.trs.texas.gov/Pages/about_publications_acfr.aspx", manualOnly: true, manualOnlyReason: "Akamai bot wall blocks automated fetch" },
  { planName: "NYSTRS", website: "https://www.nystrs.org/library/publications/annual-reports/", manualOnly: true, manualOnlyReason: "nystrs.org bot-blocks HTML fetches (HTTP 403) even with Chrome-like UA. CAFR auto-ingest not feasible; lib/scrapers/nystrs.ts works only because it fetches a single stable PDF binary URL." },
  { planName: "Wisconsin SWIB", website: "https://www.swib.state.wi.us/publications", manualOnly: true, manualOnlyReason: "Annual report is target-only by source design (no actuals published)" },

  // ── 1 plan with existing website that needs manual_only=true flipped ─
  { planName: "Colorado PERA", website: "https://www.copera.org", manualOnly: true, manualOnlyReason: "Board does not publicly publish minutes; CAFRs require Files API path due to size", hasExistingWebsite: true },
];

type ProbeResult = {
  planName: string;
  website: string;
  status: number | null;
  contentType: string | null;
  htmlOk: boolean;
  error?: string;
};

async function probe(url: string): Promise<{ status: number | null; contentType: string | null; error?: string }> {
  try {
    const res = await fetchWithDefaults(url, { method: "GET" });
    return {
      status: res.status,
      contentType: res.headers.get("content-type"),
    };
  } catch (e) {
    return {
      status: null,
      contentType: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  if (!process.env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL not set");

  console.log(`Mode: ${apply ? "APPLY (DB writes)" : "DRY-RUN (probe + report only)"}`);
  console.log(`Targets: ${TARGETS.length}`);
  console.log("");

  // Phase A: probe every URL (informational; never gates apply).
  console.log("── Phase A: URL probe ──");
  const probeResults: ProbeResult[] = [];
  for (const t of TARGETS) {
    const r = await probe(t.website);
    const htmlOk = r.status === 200 && (r.contentType ?? "").toLowerCase().includes("html");
    probeResults.push({
      planName: t.planName,
      website: t.website,
      status: r.status,
      contentType: r.contentType,
      htmlOk,
      error: r.error,
    });
    const marker = htmlOk ? "✓" : t.manualOnly ? "⚠" : "✗";
    console.log(
      `  ${marker} ${t.planName.padEnd(40)} status=${String(r.status ?? "—").padStart(3)}  ct=${(r.contentType ?? "—").slice(0, 40).padEnd(40)}${r.error ? "  err=" + r.error.slice(0, 60) : ""}`,
    );
  }

  const probeFailed = probeResults.filter((r) => !r.htmlOk && !TARGETS.find((t) => t.planName === r.planName)!.manualOnly);
  if (probeFailed.length > 0) {
    console.log("");
    console.log(`⚠ ${probeFailed.length} plan(s) flagged for auto-ingest failed the probe:`);
    for (const p of probeFailed) {
      console.log(`  - ${p.planName}: status=${p.status} ct=${p.contentType} ${p.error ?? ""}`);
    }
    console.log("These will still be written (the URL is the manual fallback target) but the heartbeat will record last_run_ok=false on them until the URL is corrected.");
  }
  console.log("");

  // Phase B: report planned UPDATEs.
  console.log("── Phase B: planned UPDATEs ──");
  for (const t of TARGETS) {
    const flags = [`website="${t.website}"`];
    if (t.manualOnly) flags.push("manual_only=true");
    console.log(`  ${t.planName.padEnd(40)} ${flags.join(", ")}`);
  }
  console.log("");

  if (!apply) {
    console.log("Dry-run complete. Re-run with --apply to commit.");
    return;
  }

  // Phase C: apply inside a single transaction with pre/post count guards.
  const c = new Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  try {
    await c.query("BEGIN");

    // Pre-flight: count how many target plans currently have website set.
    const preWebsiteCount = await c.query<{ n: number }>(
      "select count(*)::int as n from plans where name = any($1) and scrape_config ? 'website'",
      [TARGETS.map((t) => t.planName)],
    );
    const preMOCount = await c.query<{ n: number }>(
      "select count(*)::int as n from plans where name = any($1) and (scrape_config->>'manual_only')::boolean is true",
      [TARGETS.map((t) => t.planName)],
    );
    console.log(`[pre-flight] of the 14 targets, ${preWebsiteCount.rows[0].n} already have website set, ${preMOCount.rows[0].n} have manual_only=true`);

    let updatedCount = 0;
    for (const t of TARGETS) {
      const merge: Record<string, unknown> = { website: t.website };
      if (t.manualOnly) {
        merge.manual_only = true;
        if (t.manualOnlyReason) merge.manual_only_reason = t.manualOnlyReason;
      }
      const r = await c.query(
        "update plans set scrape_config = scrape_config || $1::jsonb where name = $2",
        [JSON.stringify(merge), t.planName],
      );
      if (r.rowCount !== 1) {
        throw new Error(`update for "${t.planName}" affected ${r.rowCount} rows (expected 1)`);
      }
      updatedCount++;
    }
    console.log(`[update] applied to ${updatedCount}/${TARGETS.length} plans`);

    // Post-flight: confirm websites + manual_only flags landed.
    const postWebsite = await c.query<{ n: number }>(
      "select count(*)::int as n from plans where name = any($1) and scrape_config ? 'website'",
      [TARGETS.map((t) => t.planName)],
    );
    const postMO = await c.query<{ n: number }>(
      "select count(*)::int as n from plans where name = any($1) and (scrape_config->>'manual_only')::boolean is true",
      [TARGETS.map((t) => t.planName)],
    );
    const expectedMO = TARGETS.filter((t) => t.manualOnly).length;
    console.log(`[post-flight] websites set: ${postWebsite.rows[0].n}/${TARGETS.length}, manual_only: ${postMO.rows[0].n}/${expectedMO}`);
    if (postWebsite.rows[0].n !== TARGETS.length) {
      throw new Error(`post-flight: expected ${TARGETS.length} websites, got ${postWebsite.rows[0].n}`);
    }
    if (postMO.rows[0].n !== expectedMO) {
      throw new Error(`post-flight: expected ${expectedMO} manual_only=true, got ${postMO.rows[0].n}`);
    }

    await c.query("COMMIT");
    console.log("\n[committed]");

    // Final read-back for visibility.
    const verify = await c.query<{
      name: string;
      scrape_config: Record<string, unknown>;
    }>(
      "select name, scrape_config from plans where name = any($1) order by name",
      [TARGETS.map((t) => t.planName)],
    );
    console.log("\n── final state ──");
    for (const r of verify.rows) {
      const cfg = r.scrape_config as Record<string, unknown>;
      const w = (cfg.website as string | undefined) ?? "—";
      const mo = (cfg.manual_only as boolean | undefined) ? " [manual_only]" : "";
      console.log(`  ${r.name.padEnd(40)} ${w.slice(0, 70)}${mo}`);
    }
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
