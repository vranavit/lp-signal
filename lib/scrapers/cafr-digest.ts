import { Resend } from "resend";

/**
 * CAFR dispatcher weekly digest email.
 *
 * Sends an information-dashboard email summarizing the
 * /api/cron/scrape-cafr run: ingested CAFRs, deduped, empty,
 * source/infra failures, escalation tier, quarantine events, and
 * estimated classifier cost.
 *
 * Sends always (per Phase 2 Q3) - even on a quiet "nothing happened"
 * week the digest confirms the cron is alive. Empty list-sections are
 * suppressed from the body; SUMMARY and COST ESTIMATE always render.
 *
 * Resend integration mirrors the scraper-health-check pattern (same
 * sender / recipient until sub-project D swaps to alerts@allocus.com).
 */

export type RunStats = {
  // SUMMARY counters
  plansProbed: number;
  skippedManualOnly: number;
  skippedNoAdapter: number;

  // ALREADY QUARANTINED (skipped at top of loop, no probing)
  skippedQuarantined: Array<{ planName: string; quarantinedAt: string }>;

  // NEWLY INGESTED
  ingested: Array<{
    planName: string;
    fye: string;
    sizeBytes: number;
    url: string;
  }>;

  // DEDUPED
  deduped: Array<{ planName: string; fye: string; url: string }>;

  // EMPTY
  empty: Array<{ planName: string; newestProbedUrl: string | null }>;

  // SOURCE FAILURES (escalation tier 1)
  sourceFailures1: Array<{ planName: string; error: string }>;

  // [HIGH PRIORITY] SOURCE FAILURES (escalation tier 2; tier 3 with
  // newly-quarantined goes to newlyQuarantined). lastSuccessfulAt comes
  // from fingerprint.lastChangedAt - "when we last ingested a new doc".
  sourceFailures2plus: Array<{
    planName: string;
    error: string;
    consecutiveFailures: number;
    lastSuccessfulAt: string | null;
  }>;

  // NEWLY QUARANTINED (3rd consecutive failure transitioned just now)
  newlyQuarantined: Array<{
    planName: string;
    planKey: string; // for the SQL unstick command in digest body
    error: string;
    consecutiveFailures: number;
  }>;

  // INFRA FAILURES (Allocus-side, not source-side)
  infraFailures: Array<{ planName: string; url: string; error: string }>;
};

export type DigestResult = {
  sent: boolean;
  error: string | null;
};

const ALERT_FROM = "onboarding@resend.dev"; // alerts@allocus.com deferred to sub-project D
const ALERT_TO = "vitek.vrana@bloorcapital.com";
const ESTIMATED_COST_PER_INGEST_USD = 0.3;

export async function sendCafrDigest(
  stats: RunStats,
  runStartedAt: string,
): Promise<DigestResult> {
  const subject = buildSubject(stats);
  const text = buildBody(stats, runStartedAt);

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { sent: false, error: "RESEND_API_KEY not set" };
  }

  try {
    await new Resend(apiKey).emails.send({
      from: ALERT_FROM,
      to: ALERT_TO,
      subject,
      text,
    });
    return { sent: true, error: null };
  } catch (err) {
    return {
      sent: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function buildSubject(stats: RunStats): string {
  const totalFailed =
    stats.sourceFailures1.length +
    stats.sourceFailures2plus.length +
    stats.newlyQuarantined.length +
    stats.infraFailures.length;
  const counts = `${stats.ingested.length} ingested, ${stats.deduped.length} deduped, ${totalFailed} failed`;
  const highPriority =
    stats.newlyQuarantined.length > 0 ||
    stats.sourceFailures2plus.length > 0;
  if (highPriority) {
    return `Allocus CAFR ingest [HIGH PRIORITY]: ${counts} (${stats.newlyQuarantined.length} QUARANTINED)`;
  }
  return `Allocus CAFR ingest: ${counts}`;
}

function buildBody(stats: RunStats, runStartedAt: string): string {
  const lines: string[] = [];
  lines.push("=== Allocus CAFR ingest digest ===");
  lines.push(`Run: ${runStartedAt}`);
  lines.push("");

  const sourceFailureTotal =
    stats.sourceFailures1.length +
    stats.sourceFailures2plus.length +
    stats.newlyQuarantined.length;
  lines.push("SUMMARY");
  lines.push(`  Plans probed:           ${stats.plansProbed}`);
  lines.push(`  Skipped (manual_only):  ${stats.skippedManualOnly}`);
  lines.push(`  Skipped (no adapter):   ${stats.skippedNoAdapter}`);
  lines.push(`  Skipped (quarantined):  ${stats.skippedQuarantined.length}`);
  lines.push(`  Ingested:               ${stats.ingested.length}`);
  lines.push(`  Deduped:                ${stats.deduped.length}`);
  lines.push(`  Empty (no new doc):     ${stats.empty.length}`);
  lines.push(`  Source failures:        ${sourceFailureTotal}`);
  lines.push(`  Infra failures:         ${stats.infraFailures.length}`);
  lines.push("");

  if (stats.ingested.length > 0) {
    lines.push(`NEWLY INGESTED (${stats.ingested.length}):`);
    for (const r of stats.ingested) {
      const sizeMb = (r.sizeBytes / 1024 / 1024).toFixed(2);
      lines.push(`  - ${r.planName}: FY${r.fye}, ${sizeMb} MB`);
      lines.push(`    URL: ${r.url}`);
    }
    lines.push("");
  }

  if (stats.deduped.length > 0) {
    lines.push(`DEDUPED (${stats.deduped.length}, expected on most weeks):`);
    for (const r of stats.deduped) {
      lines.push(`  - ${r.planName}: FY${r.fye} (already in storage)`);
    }
    lines.push("");
  }

  if (stats.empty.length > 0) {
    lines.push(
      `EMPTY (${stats.empty.length}, normal for plans pending publication):`,
    );
    for (const r of stats.empty) {
      const newest = r.newestProbedUrl ?? "<no candidates>";
      lines.push(`  - ${r.planName}: probed ${newest}, source returned 4xx`);
    }
    lines.push("");
  }

  if (stats.sourceFailures2plus.length > 0) {
    lines.push(
      `[HIGH PRIORITY] SOURCE FAILURES (escalation tier 2+) (${stats.sourceFailures2plus.length}):`,
    );
    for (const r of stats.sourceFailures2plus) {
      const lastOk = r.lastSuccessfulAt ?? "never";
      lines.push(
        `  - ${r.planName}: ${r.consecutiveFailures} consecutive failures. Last error: ${r.error}`,
      );
      lines.push(`    Last successful: ${lastOk}`);
    }
    lines.push("");
  }

  if (stats.sourceFailures1.length > 0) {
    lines.push(
      `SOURCE FAILURES (1st consecutive) (${stats.sourceFailures1.length}):`,
    );
    for (const r of stats.sourceFailures1) {
      lines.push(`  - ${r.planName}: ${r.error}`);
    }
    lines.push("");
  }

  if (stats.newlyQuarantined.length > 0) {
    lines.push(`NEWLY QUARANTINED (${stats.newlyQuarantined.length}):`);
    for (const r of stats.newlyQuarantined) {
      lines.push(
        `  - ${r.planName}: quarantined after ${r.consecutiveFailures} consecutive failures. Auto-probing disabled.`,
      );
      lines.push(`    Last error: ${r.error}`);
      lines.push(`    Manual unstick:`);
      lines.push(`      UPDATE scrape_fingerprints`);
      lines.push(`      SET quarantined_at = NULL, consecutive_failures = 0`);
      lines.push(`      WHERE source_key = 'cafr-${r.planKey}';`);
    }
    lines.push("");
  }

  if (stats.skippedQuarantined.length > 0) {
    lines.push(
      `ALREADY QUARANTINED (skipped this run) (${stats.skippedQuarantined.length}):`,
    );
    for (const r of stats.skippedQuarantined) {
      lines.push(
        `  - ${r.planName}: quarantined since ${r.quarantinedAt}. Manual unstick required.`,
      );
    }
    lines.push("");
  }

  if (stats.infraFailures.length > 0) {
    lines.push(
      `INFRA FAILURES (Allocus-side, not source-side) (${stats.infraFailures.length}):`,
    );
    for (const r of stats.infraFailures) {
      lines.push(
        `  - ${r.planName}: source returned 200+PDF but ingestCafr error: ${r.error}`,
      );
      lines.push(`    URL: ${r.url}`);
    }
    lines.push("");
  }

  const cost = (
    stats.ingested.length * ESTIMATED_COST_PER_INGEST_USD
  ).toFixed(2);
  lines.push("COST ESTIMATE");
  lines.push(
    `  This run: $${cost} (${stats.ingested.length} CAFRs * $${ESTIMATED_COST_PER_INGEST_USD.toFixed(2)} estimated classifier cost per CAFR)`,
  );
  lines.push(
    "  Note: heartbeat-side estimate only; tracked separately in classifier metrics.",
  );

  return lines.join("\n");
}
