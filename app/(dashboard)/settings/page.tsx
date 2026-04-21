import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <div className="text-[11px] uppercase tracking-widest text-ink-faint mono">
          Dashboard / Settings
        </div>
        <h1 className="mt-1 text-lg font-semibold tracking-tightish text-ink">Account</h1>
      </div>
      <div className="panel divide-y divide-line">
        <Row label="Email" value={user?.email ?? "—"} />
        <Row label="User ID" value={user?.id ?? "—"} />
        <Row label="Last sign-in" value={user?.last_sign_in_at ?? "—"} />
      </div>
      <p className="text-xs text-ink-muted">
        Saved searches, alerts, and firm-level settings ship in Phase 4.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-4 px-4 py-3 text-sm">
      <div className="text-[11px] uppercase tracking-widest text-ink-faint mono">
        {label}
      </div>
      <div className="mono text-ink">{value}</div>
    </div>
  );
}
