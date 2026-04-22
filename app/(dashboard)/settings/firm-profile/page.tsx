import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FirmProfileForm } from "./firm-profile-form";

export const dynamic = "force-dynamic";

export default async function FirmProfilePage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase
        .from("firm_profiles")
        .select(
          "firm_name, asset_class_focus, fund_stage, check_size_min_usd, check_size_max_usd, geographic_focus",
        )
        .eq("user_id", user.id)
        .maybeSingle()
    : { data: null };

  const initial = {
    firm_name: profile?.firm_name ?? null,
    asset_class_focus: profile?.asset_class_focus ?? [],
    fund_stage: profile?.fund_stage ?? null,
    check_size_min_usd: profile?.check_size_min_usd ?? null,
    check_size_max_usd: profile?.check_size_max_usd ?? null,
    geographic_focus: profile?.geographic_focus ?? [],
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1 text-[12px] text-ink-muted hover:text-ink"
      >
        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
        Settings
      </Link>
      <div>
        <h1 className="text-[15px] font-semibold tracking-tightish text-ink leading-tight">
          Firm profile
        </h1>
        <p className="mt-1 text-[12px] text-ink-muted">
          Your ICP. Signals get a relevance score computed against these fields
          on every signals query.
        </p>
      </div>

      <FirmProfileForm initial={initial} />
    </div>
  );
}
