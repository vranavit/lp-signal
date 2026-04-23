import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  OutreachWorkspace,
  type OutreachRow,
  type PlanUnfundedRow,
} from "./outreach-workspace";
import { privateMarketsUnfundedUsd } from "@/lib/relevance/unfunded";

export const dynamic = "force-dynamic";

const ADMIN_EMAILS = new Set(["vitek.vrana@bloorcapital.com"]);

export default async function OutreachPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: userProfile } = await supabase
    .from("user_profiles")
    .select("role, email")
    .eq("id", user.id)
    .maybeSingle();

  const isAdmin =
    ADMIN_EMAILS.has(user.email?.toLowerCase() ?? "") ||
    userProfile?.role === "admin";

  if (!isAdmin) {
    redirect("/signals");
  }

  // Outreach is a pension-focused cross-firm view. GP-side press-release
  // signals (plan_id null, gp_id set) belong on /signals instead — they
  // have no pension context to target here and previously crashed the
  // client workspace at r.plan.country. Filter them out at the source.
  const { data, error } = await supabase
    .from("signals")
    .select(
      "id, plan_id, gp_id, document_id, signal_type, confidence, priority_score, asset_class, summary, fields, source_page, source_quote, commitment_amount_usd, preliminary, created_at, plan:plans!inner(id, name, country, aum_usd), document:documents(id, source_url, meeting_date)",
    )
    .not("validated_at", "is", null)
    .not("plan_id", "is", null)
    .eq("seed_data", false)
    .order("created_at", { ascending: false })
    .limit(500);

  const rows = ((data ?? []) as unknown as OutreachRow[]).filter(
    (r) => r.plan != null,
  );

  // Compute unfunded budget per plan from the latest pension_allocations
  // snapshot. Server-side so the outreach UI can filter without paginating.
  const { data: allocs } = await supabase
    .from("pension_allocations")
    .select(
      "plan_id, asset_class, target_pct, actual_pct, total_plan_aum_usd, as_of_date, plan:plans(id, name, country, scrape_config)",
    )
    .eq("preliminary", false);

  type AllocRow = {
    plan_id: string;
    asset_class: string;
    target_pct: number;
    actual_pct: number | null;
    total_plan_aum_usd: number | null;
    as_of_date: string;
    plan: {
      id: string;
      name: string;
      country: string;
      scrape_config: Record<string, unknown> | null;
    } | null;
  };

  const allocList = (allocs ?? []) as unknown as AllocRow[];

  // For each plan, take the most recent as_of_date snapshot and compute
  // private-markets unfunded budget. Anything ≤ 0 (no underweight in PE/
  // Infra/Credit/RE/VC) is omitted from the table.
  const byPlan = new Map<string, AllocRow[]>();
  for (const a of allocList) {
    if (!byPlan.has(a.plan_id)) byPlan.set(a.plan_id, []);
    byPlan.get(a.plan_id)!.push(a);
  }
  const planUnfunded: PlanUnfundedRow[] = [];
  for (const [, list] of byPlan) {
    list.sort((a, b) => b.as_of_date.localeCompare(a.as_of_date));
    const latestDate = list[0].as_of_date;
    const latest = list.filter((r) => r.as_of_date === latestDate);
    const total = privateMarketsUnfundedUsd(latest);
    if (total <= 0 || !latest[0].plan) continue;
    const slug =
      typeof latest[0].plan.scrape_config === "object" &&
      latest[0].plan.scrape_config
        ? ((latest[0].plan.scrape_config as Record<string, unknown>).key as
            | string
            | undefined) ?? null
        : null;
    planUnfunded.push({
      plan_id: latest[0].plan.id,
      plan_name: latest[0].plan.name,
      country: latest[0].plan.country,
      slug,
      as_of_date: latestDate,
      unfunded_usd: total,
    });
  }
  planUnfunded.sort((a, b) => b.unfunded_usd - a.unfunded_usd);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[15px] font-semibold tracking-tightish text-ink leading-tight">
          Outreach
        </h1>
        <p className="mt-1 text-[12px] text-ink-muted">
          Cross-firm view. Personal cold-email targeting — not customer-facing.
        </p>
      </div>
      {error ? (
        <div className="card-surface p-4 text-[13px] text-ink-muted">
          Failed to load signals: {error.message}
        </div>
      ) : (
        <OutreachWorkspace rows={rows} planUnfunded={planUnfunded} />
      )}
    </div>
  );
}
