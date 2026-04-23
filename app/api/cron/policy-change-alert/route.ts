import { NextResponse, type NextRequest } from "next/server";
import { Resend } from "resend";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Daily digest of policy-target moves detected in the last 24 hours. Noise
// floor: changes below 0.5 percentage points are skipped; they're usually
// rounding or classifier-split artifacts (see the "Other" sub-sleeve
// warning in docs/day-5-notes.md). Meaningful moves trigger an email to
// Vitek with plan, asset class, prev→new, and implied $ delta.
const WINDOW_HOURS = 24;
const MIN_CHANGE_PP = 0.5;
const ALERT_FROM = "onboarding@resend.dev"; // swap to alerts@allocus.com after domain verify
const ALERT_TO = "vitek.vrana@bloorcapital.com";

type PolicyChangeRow = {
  id: string;
  asset_class: string;
  previous_target_pct: number;
  new_target_pct: number;
  change_pp: number;
  change_direction: "increase" | "decrease" | "no_change";
  as_of_date_previous: string;
  as_of_date_new: string;
  implied_usd_delta: number | null;
  detected_at: string;
  plan: { id: string; name: string } | null;
};

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;

  const query = request.nextUrl.searchParams.get("secret");
  if (query && query === secret) return true;

  if (request.headers.get("x-vercel-cron") === "1" && process.env.VERCEL) {
    return true;
  }
  return false;
}

function formatUsd(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  const cutoff = new Date(
    Date.now() - WINDOW_HOURS * 3_600_000,
  ).toISOString();

  const { data, error } = await supabase
    .from("allocation_policy_changes")
    .select(
      "id, asset_class, previous_target_pct, new_target_pct, change_pp, change_direction, as_of_date_previous, as_of_date_new, implied_usd_delta, detected_at, plan:plans!inner(id, name)",
    )
    .gte("detected_at", cutoff)
    .order("detected_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "query_failed", detail: error.message },
      { status: 500 },
    );
  }

  const rows = (data ?? []) as unknown as PolicyChangeRow[];
  const meaningful = rows.filter(
    (r) => Math.abs(Number(r.change_pp)) >= MIN_CHANGE_PP,
  );

  const ranAt = new Date().toISOString();

  if (meaningful.length === 0) {
    return NextResponse.json({
      ok: true,
      ranAt,
      windowHours: WINDOW_HOURS,
      minChangePp: MIN_CHANGE_PP,
      changesDetected: rows.length,
      meaningfulChanges: 0,
      emailed: false,
    });
  }

  // Group by plan for readable email body.
  const byPlan = new Map<string, { planName: string; rows: PolicyChangeRow[] }>();
  for (const r of meaningful) {
    const planName = r.plan?.name ?? "(unknown plan)";
    const key = r.plan?.id ?? planName;
    if (!byPlan.has(key)) byPlan.set(key, { planName, rows: [] });
    byPlan.get(key)!.rows.push(r);
  }

  const lines: string[] = [
    `Policy-change digest — ${meaningful.length} meaningful change(s) detected in the last ${WINDOW_HOURS}h.`,
    `(Noise floor: |Δ| >= ${MIN_CHANGE_PP} pp.)`,
    "",
  ];
  for (const { planName, rows: planRows } of byPlan.values()) {
    lines.push(`== ${planName}`);
    for (const r of planRows) {
      const sign = r.change_direction === "increase" ? "↑" : "↓";
      const deltaPp = Number(r.change_pp).toFixed(1);
      const usd =
        r.implied_usd_delta != null
          ? ` (~${formatUsd(Number(r.implied_usd_delta))} implied)`
          : "";
      lines.push(
        `  ${r.asset_class.padEnd(14)} ${Number(r.previous_target_pct).toFixed(1)}% → ${Number(r.new_target_pct).toFixed(1)}%  ${sign}${deltaPp}pp${usd}  (${r.as_of_date_previous} → ${r.as_of_date_new})`,
      );
    }
    lines.push("");
  }
  lines.push(`Generated at ${ranAt}.`);
  const body = lines.join("\n");

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(
      `[policy-change-alert] RESEND_API_KEY not set — would email ${meaningful.length} changes`,
    );
    return NextResponse.json({
      ok: true,
      ranAt,
      windowHours: WINDOW_HOURS,
      minChangePp: MIN_CHANGE_PP,
      changesDetected: rows.length,
      meaningfulChanges: meaningful.length,
      emailed: false,
      reason: "no_api_key",
      preview: body,
    });
  }

  try {
    const resend = new Resend(apiKey);
    const subject =
      meaningful.length === 1
        ? `[Allocus] Policy change: ${meaningful[0].plan?.name ?? "plan"} ${meaningful[0].asset_class} ${Number(meaningful[0].change_pp) > 0 ? "+" : ""}${Number(meaningful[0].change_pp).toFixed(1)}pp`
        : `[Allocus] Policy-change digest: ${meaningful.length} changes across ${byPlan.size} plan(s)`;
    const sent = await resend.emails.send({
      from: ALERT_FROM,
      to: ALERT_TO,
      subject,
      text: body,
    });
    return NextResponse.json({
      ok: true,
      ranAt,
      windowHours: WINDOW_HOURS,
      minChangePp: MIN_CHANGE_PP,
      changesDetected: rows.length,
      meaningfulChanges: meaningful.length,
      emailed: !sent.error,
      emailId: sent.data?.id ?? null,
      error: sent.error?.message ?? null,
    });
  } catch (err) {
    return NextResponse.json({
      ok: true,
      ranAt,
      meaningfulChanges: meaningful.length,
      emailed: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
