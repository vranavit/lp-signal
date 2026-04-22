import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { OutreachWorkspace, type OutreachRow } from "./outreach-workspace";

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

  const { data, error } = await supabase
    .from("signals")
    .select(
      "id, plan_id, gp_id, document_id, signal_type, confidence, priority_score, asset_class, summary, fields, source_page, source_quote, commitment_amount_usd, preliminary, created_at, plan:plans(id, name, country, aum_usd), document:documents(id, source_url, meeting_date)",
    )
    .not("validated_at", "is", null)
    .eq("seed_data", false)
    .order("created_at", { ascending: false })
    .limit(500);

  const rows = (data ?? []) as unknown as OutreachRow[];

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
        <OutreachWorkspace rows={rows} />
      )}
    </div>
  );
}
