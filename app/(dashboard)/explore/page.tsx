import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ExploreWorkspace } from "./explore-workspace";
import type { ExploreSignal, ExplorePlan } from "./explore-types";

export const dynamic = "force-dynamic";

export default async function ExplorePage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Pull all T1 commitment signals + the plan + the source document for the
  // expanded-row link. seed_data filtered out (the legacy seed row uses a
  // different JSONB key shape than the v2.3 classifier output and would
  // confuse the workbench).
  const { data: signalRows, error: signalsErr } = await supabase
    .from("signals")
    .select(
      "id, plan_id, document_id, fields, summary, source_page, source_quote, commitment_amount_usd, confidence, priority_score, preliminary, created_at, plan:plans!inner(id, name), document:documents(id, source_url, meeting_date)",
    )
    .eq("signal_type", 1)
    .eq("seed_data", false)
    .not("plan_id", "is", null);

  const { data: planRows, error: plansErr } = await supabase
    .from("plans")
    .select("id, name")
    .order("name", { ascending: true });

  const signals = (signalRows ?? []) as unknown as ExploreSignal[];
  const plans = (planRows ?? []) as ExplorePlan[];

  const loadError = signalsErr?.message ?? plansErr?.message ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[15px] font-semibold tracking-tightish text-ink leading-tight">
          Explore
        </h1>
        <p className="mt-1 text-[12px] text-ink-muted">
          Filter and explore {signals.length.toLocaleString()} commitment signals across {plans.length} pension plans. URL is shareable.
        </p>
      </div>
      {loadError ? (
        <div className="card-surface p-4 text-[13px] text-ink-muted">
          Failed to load signals: {loadError}
        </div>
      ) : (
        <ExploreWorkspace signals={signals} plans={plans} />
      )}
    </div>
  );
}
