import { NextResponse, type NextRequest } from "next/server";
import { Resend } from "resend";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Per-plan drift detector. Fires when a plan's preliminary rate over the
// last 24 hours crosses the threshold — proposal §6 guardrail against the
// classifier silently drifting toward low confidence.
const WINDOW_HOURS = 24;
const RATIO_THRESHOLD = 0.30;
const MIN_ACCEPTED = 3;
const ALERT_FROM = "onboarding@resend.dev"; // swap to alerts@allocus.com after domain verify
const ALERT_TO = "vitek.vrana@bloorcapital.com";

type PlanBucket = {
  planId: string;
  planName: string;
  accepted: number;
  preliminary: number;
};

type AlertPayload = PlanBucket & { ratio: number };

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

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  const cutoff = new Date(
    Date.now() - WINDOW_HOURS * 3_600_000,
  ).toISOString();

  const { data, error } = await supabase
    .from("signals")
    .select("plan_id, preliminary, plan:plans!inner(id, name)")
    .gte("created_at", cutoff)
    .eq("seed_data", false);

  if (error) {
    return NextResponse.json(
      { error: "query_failed", detail: error.message },
      { status: 500 },
    );
  }

  const buckets = new Map<string, PlanBucket>();
  for (const row of (data ?? []) as unknown as Array<{
    plan_id: string;
    preliminary: boolean;
    plan: { id: string; name: string };
  }>) {
    let b = buckets.get(row.plan_id);
    if (!b) {
      b = {
        planId: row.plan_id,
        planName: row.plan?.name ?? "(unknown)",
        accepted: 0,
        preliminary: 0,
      };
      buckets.set(row.plan_id, b);
    }
    if (row.preliminary) b.preliminary++;
    else b.accepted++;
  }

  const alerts: AlertPayload[] = [];
  for (const b of buckets.values()) {
    if (b.accepted < MIN_ACCEPTED) continue;
    const ratio = b.preliminary / b.accepted;
    if (ratio > RATIO_THRESHOLD) {
      alerts.push({ ...b, ratio });
    }
  }

  const ranAt = new Date().toISOString();
  const emailResults: Array<{
    planId: string;
    ok: boolean;
    reason?: string;
    id?: string;
  }> = [];

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    for (const a of alerts) {
      console.warn(
        `[preliminary-alert] RESEND_API_KEY not set — would alert: plan=${a.planName} ratio=${a.ratio.toFixed(2)} accepted=${a.accepted} preliminary=${a.preliminary}`,
      );
      emailResults.push({ planId: a.planId, ok: false, reason: "no_api_key" });
    }
  } else if (alerts.length > 0) {
    const resend = new Resend(apiKey);
    for (const a of alerts) {
      const body =
        `Plan: ${a.planName}\n` +
        `Preliminary / accepted ratio: ${a.ratio.toFixed(2)} (threshold ${RATIO_THRESHOLD.toFixed(2)})\n` +
        `Accepted (last ${WINDOW_HOURS}h): ${a.accepted}\n` +
        `Preliminary (last ${WINDOW_HOURS}h): ${a.preliminary}\n` +
        `Detected at: ${ranAt}\n\n` +
        `This is an automated alert. See docs/proposals/confidence-tiered-auto-approval.md §6.`;
      try {
        const sent = await resend.emails.send({
          from: ALERT_FROM,
          to: ALERT_TO,
          subject: `[Allocus] Preliminary drift alert: ${a.planName}`,
          text: body,
        });
        if (sent.error) {
          emailResults.push({
            planId: a.planId,
            ok: false,
            reason: sent.error.message,
          });
        } else {
          emailResults.push({
            planId: a.planId,
            ok: true,
            id: sent.data?.id,
          });
        }
      } catch (err) {
        emailResults.push({
          planId: a.planId,
          ok: false,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    ranAt,
    windowHours: WINDOW_HOURS,
    threshold: RATIO_THRESHOLD,
    minAccepted: MIN_ACCEPTED,
    plansEvaluated: buckets.size,
    alerts,
    emailResults,
  });
}
