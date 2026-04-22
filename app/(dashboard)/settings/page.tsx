import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ThemeToggle } from "@/components/theme-toggle";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="space-y-4 max-w-2xl">
      <h1 className="text-[15px] font-semibold tracking-tightish text-ink leading-tight">
        Settings
      </h1>

      <section className="card-surface">
        <div className="px-4 py-3 border-b border-line">
          <div className="text-[13px] font-medium text-ink">Account</div>
        </div>
        <Row label="Email" value={user?.email ?? "—"} />
        <Row label="User ID" value={user?.id ?? "—"} mono />
        <Row label="Last sign-in" value={user?.last_sign_in_at ?? "—"} mono />
      </section>

      <section className="card-surface">
        <div className="px-4 py-3 border-b border-line">
          <div className="text-[13px] font-medium text-ink">Firm profile</div>
          <div className="mt-0.5 text-[12px] text-ink-muted">
            Your ICP — asset class, check size, geography. Drives relevance
            scoring on the signals feed.
          </div>
        </div>
        <Link
          href="/settings/firm-profile"
          className="flex items-center justify-between px-4 py-3 hover:bg-bg-subtle transition-colors duration-150"
        >
          <span className="text-[13px] text-ink">Configure firm profile</span>
          <ChevronRight className="h-4 w-4 text-ink-faint" strokeWidth={1.75} />
        </Link>
      </section>

      <section className="card-surface">
        <div className="px-4 py-3 border-b border-line">
          <div className="text-[13px] font-medium text-ink">Appearance</div>
          <div className="mt-0.5 text-[12px] text-ink-muted">
            Light is the default. Dark mode is available for extended review
            sessions.
          </div>
        </div>
        <div className="px-4 py-3">
          <ThemeToggle />
        </div>
      </section>

      <p className="text-[12px] text-ink-muted">
        Saved searches, alerts, and firm-level settings ship in Phase 4.
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-4 px-4 py-3 border-b border-line last:border-b-0">
      <div className="text-[12px] text-ink-faint">{label}</div>
      <div
        className={
          (mono ? "num tabular-nums " : "") +
          "text-[13px] text-ink break-all"
        }
      >
        {value}
      </div>
    </div>
  );
}
