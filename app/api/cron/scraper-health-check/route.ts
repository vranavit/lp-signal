import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedCron } from "@/lib/scrapers/cron-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily scraper health-check. Reads every row in scrape_fingerprints and
 * flags any source whose `last_checked_at` is older than 2× its
 * `expected_cadence_hours`. Sends a single digest email to Vitek when
 * stale sources exist — silence otherwise (no green-light spam).
 *
 * This is the safety net for "scraper silently broke and nobody
 * noticed". The most dangerous failure mode for Allocus: users look at
 * data, assume it's current, but nothing is being checked.
 */

const ALERT_FROM = "onboarding@resend.dev"; // swap to alerts@allocus.com after domain verify
const ALERT_TO = "vitek.vrana@bloorcapital.com";

type StaleRow = {
  sourceKey: string;
  lastCheckedAt: string | null;
  lastChangedAt: string | null;
  expectedCadenceHours: number;
  lastRunOk: boolean;
  hoursSinceCheck: number | null;
  staleness: "yellow" | "red";
};

export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const supabase = createSupabaseAdminClient();

  const { data: rows, error } = await supabase
    .from("scrape_fingerprints")
    .select(
      "source_key, last_checked_at, last_changed_at, expected_cadence_hours, last_run_ok",
    );
  if (error) {
    return NextResponse.json(
      { error: "query_failed", detail: error.message },
      { status: 500 },
    );
  }

  const now = Date.now();
  const stale: StaleRow[] = [];
  for (const r of rows ?? []) {
    const checked = r.last_checked_at
      ? new Date(r.last_checked_at).getTime()
      : null;
    const hoursSince = checked == null ? null : (now - checked) / 3_600_000;
    const cadence = r.expected_cadence_hours ?? 24;
    let staleness: "green" | "yellow" | "red" = "green";
    if (hoursSince == null) staleness = "red";
    else if (hoursSince > cadence * 2) staleness = "red";
    else if (hoursSince > cadence) staleness = "yellow";
    if (staleness === "yellow" || staleness === "red") {
      stale.push({
        sourceKey: r.source_key,
        lastCheckedAt: r.last_checked_at,
        lastChangedAt: r.last_changed_at,
        expectedCadenceHours: cadence,
        lastRunOk: r.last_run_ok,
        hoursSinceCheck: hoursSince,
        staleness,
      });
    }
  }

  if (stale.length === 0) {
    return NextResponse.json({
      ok: true,
      ranAt: new Date().toISOString(),
      stale: 0,
      message: "all sources fresh",
    });
  }

  // Sort worst-first.
  stale.sort((a, b) => {
    if (a.staleness !== b.staleness) {
      return a.staleness === "red" ? -1 : 1;
    }
    return (b.hoursSinceCheck ?? 0) - (a.hoursSinceCheck ?? 0);
  });

  const subject = `Allocus scraper health: ${stale.length} source${stale.length === 1 ? "" : "s"} stale`;
  const lines: string[] = [];
  lines.push(
    `${stale.length} scraper source${stale.length === 1 ? "" : "s"} ha${stale.length === 1 ? "s" : "ve"} exceeded the expected check cadence.`,
  );
  lines.push("");
  for (const s of stale) {
    const last = s.lastCheckedAt
      ? new Date(s.lastCheckedAt).toISOString().slice(0, 16).replace("T", " ") + " UTC"
      : "never";
    const hrs = s.hoursSinceCheck == null
      ? "∞"
      : `${s.hoursSinceCheck.toFixed(1)}h`;
    lines.push(
      `• [${s.staleness.toUpperCase()}] ${s.sourceKey}: last checked ${last} (${hrs} ago, expected ≤ ${s.expectedCadenceHours}h). ok=${s.lastRunOk}`,
    );
  }
  lines.push("");
  lines.push("Investigate at /admin/ingestion or re-run the affected cron manually.");

  const text = lines.join("\n");

  const apiKey = process.env.RESEND_API_KEY;
  let emailSent = false;
  let emailError: string | null = null;
  if (apiKey) {
    try {
      const resend = new Resend(apiKey);
      await resend.emails.send({
        from: ALERT_FROM,
        to: ALERT_TO,
        subject,
        text,
      });
      emailSent = true;
    } catch (err) {
      emailError = err instanceof Error ? err.message : String(err);
    }
  } else {
    emailError = "RESEND_API_KEY not set";
  }

  return NextResponse.json({
    ok: true,
    ranAt: new Date().toISOString(),
    stale: stale.length,
    subject,
    emailSent,
    emailError,
    stale_detail: stale,
  });
}
