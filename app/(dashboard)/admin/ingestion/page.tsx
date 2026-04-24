import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/utils";
import { TimeAgo } from "@/components/accuracy/time-ago";

export const dynamic = "force-dynamic";

const ADMIN_EMAILS = new Set(["vitek.vrana@bloorcapital.com"]);

type FingerprintRow = {
  source_key: string;
  last_hash: string | null;
  last_checked_at: string | null;
  last_changed_at: string | null;
  expected_cadence_hours: number;
  last_run_ok: boolean;
  last_run_summary: string | null;
};

type LastDocRow = {
  id: string;
  source_url: string;
  created_at: string;
  plan_name: string | null;
  gp_name: string | null;
};

type SourceBucket = "gp" | "pension_board" | "pension_txn" | "cafr" | "other";

function bucketFor(key: string): SourceBucket {
  if (key === "blackstone" || key === "brookfield" || key === "apollo") return "gp";
  if (key === "nyscrf") return "pension_txn";
  if (key.startsWith("cafr-")) return "cafr";
  if (
    key === "calpers" ||
    key === "calstrs" ||
    key === "nystrs" ||
    key === "psers" ||
    key === "michigan" ||
    key === "wsib" ||
    key === "oregon_pers" ||
    key === "ma_prim" ||
    key === "vrs" ||
    key === "nj_doi" ||
    key === "lacera"
  )
    return "pension_board";
  return "other";
}

function statusFor(
  lastCheckedAt: string | null,
  expectedCadenceHours: number,
): { tone: "green" | "yellow" | "red"; label: string } {
  if (!lastCheckedAt) return { tone: "red", label: "Never checked" };
  const hoursSince =
    (Date.now() - new Date(lastCheckedAt).getTime()) / 3_600_000;
  if (hoursSince > expectedCadenceHours * 2) {
    return { tone: "red", label: "Stale — > 2× cadence" };
  }
  if (hoursSince > expectedCadenceHours) {
    return { tone: "yellow", label: "Late — > 1× cadence" };
  }
  return { tone: "green", label: "Fresh" };
}

export default async function AdminIngestionPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role, email")
    .eq("id", user.id)
    .maybeSingle();
  const isAdmin =
    ADMIN_EMAILS.has(user.email?.toLowerCase() ?? "") ||
    profile?.role === "admin";
  if (!isAdmin) redirect("/signals");

  // Use admin client for reads — scrape_fingerprints has RLS with no
  // authenticated policies (service-role-only), and this page is
  // already gated to admins.
  const admin = createSupabaseAdminClient();
  const { data: fingerprintsRaw } = await admin
    .from("scrape_fingerprints")
    .select(
      "source_key, last_hash, last_checked_at, last_changed_at, expected_cadence_hours, last_run_ok, last_run_summary",
    )
    .order("source_key");
  const fingerprints = (fingerprintsRaw ?? []) as FingerprintRow[];

  // Most recent ingested document per source — best-effort correlation
  // between `source_key` and either a plan name (scrape_config.key) or a
  // GP name. One join per source; the set is small (~14 rows).
  const lastDocs = new Map<string, LastDocRow>();
  for (const f of fingerprints) {
    const bucket = bucketFor(f.source_key);
    if (bucket === "gp") {
      const gpName =
        f.source_key.charAt(0).toUpperCase() + f.source_key.slice(1);
      const { data } = await admin
        .from("documents")
        .select(
          "id, source_url, created_at, gp:gps(name), plan:plans(name)",
        )
        .eq("processing_status", "complete")
        .not("gp_id", "is", null)
        .eq("gp.name", gpName)
        .order("created_at", { ascending: false })
        .limit(1);
      const row = (data ?? [])[0] as unknown as
        | {
            id: string;
            source_url: string;
            created_at: string;
            gp: { name: string } | null;
            plan: { name: string } | null;
          }
        | undefined;
      if (row) {
        lastDocs.set(f.source_key, {
          id: row.id,
          source_url: row.source_url,
          created_at: row.created_at,
          plan_name: row.plan?.name ?? null,
          gp_name: row.gp?.name ?? null,
        });
      }
    } else if (bucket === "pension_board" || bucket === "pension_txn") {
      const { data: plans } = await admin
        .from("plans")
        .select("id")
        .eq("scrape_config->>key", f.source_key)
        .limit(1);
      const planId = (plans ?? [])[0]?.id;
      if (!planId) continue;
      const { data } = await admin
        .from("documents")
        .select("id, source_url, created_at, plan:plans(name)")
        .eq("plan_id", planId)
        .eq("processing_status", "complete")
        .order("created_at", { ascending: false })
        .limit(1);
      const row = (data ?? [])[0] as unknown as
        | {
            id: string;
            source_url: string;
            created_at: string;
            plan: { name: string } | null;
          }
        | undefined;
      if (row) {
        lastDocs.set(f.source_key, {
          id: row.id,
          source_url: row.source_url,
          created_at: row.created_at,
          plan_name: row.plan?.name ?? null,
          gp_name: null,
        });
      }
    }
  }

  // Summary counts across traffic lights.
  const counts = { green: 0, yellow: 0, red: 0 };
  for (const f of fingerprints) {
    const s = statusFor(f.last_checked_at, f.expected_cadence_hours).tone;
    counts[s] += 1;
  }

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tightish text-ink leading-tight">
            Ingestion health
          </h1>
          <p className="mt-1 text-[12px] text-ink-muted">
            Per-source status for every continuous scraper. Runs under{" "}
            <code className="text-[11.5px]">/api/cron/scrape-*</code>; fingerprints are written after every cron invocation.
          </p>
        </div>
        <div className="flex items-center gap-3 text-[12px]">
          <StatusPill tone="green" count={counts.green} label="Fresh" />
          <StatusPill tone="yellow" count={counts.yellow} label="Late" />
          <StatusPill tone="red" count={counts.red} label="Stale" />
        </div>
      </div>

      {fingerprints.length === 0 ? (
        <div className="card-surface p-6 text-[13px] text-ink-muted">
          No fingerprints recorded yet. Once the cron endpoints start running
          (first schedule fire after deploy), rows will appear here.
        </div>
      ) : (
        <div className="card-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-ink-faint">
                  <Th>Source</Th>
                  <Th className="w-[110px]">Bucket</Th>
                  <Th className="w-[110px]">Cadence</Th>
                  <Th className="w-[140px]">Last checked</Th>
                  <Th className="w-[140px]">Last changed</Th>
                  <Th className="w-[100px]">Status</Th>
                  <Th>Last run summary</Th>
                  <Th className="w-[120px]">Last doc</Th>
                </tr>
              </thead>
              <tbody>
                {fingerprints.map((f) => {
                  const status = statusFor(
                    f.last_checked_at,
                    f.expected_cadence_hours,
                  );
                  const lastDoc = lastDocs.get(f.source_key) ?? null;
                  return (
                    <tr
                      key={f.source_key}
                      className="h-11 border-b border-line last:border-b-0 odd:bg-black/[0.015] dark:odd:bg-white/[0.02]"
                    >
                      <td className="px-3 align-middle">
                        <div className="text-[13px] text-ink font-medium">
                          {f.source_key}
                        </div>
                        {!f.last_run_ok ? (
                          <div className="text-[10.5px] text-red-700 mt-0.5">
                            last run reported errors
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 align-middle text-[12px] text-ink-muted">
                        {bucketFor(f.source_key)}
                      </td>
                      <td className="px-3 align-middle num tabular-nums text-[12px] text-ink-muted">
                        {f.expected_cadence_hours}h
                      </td>
                      <td className="px-3 align-middle">
                        <TimeAgo date={f.last_checked_at} />
                      </td>
                      <td className="px-3 align-middle">
                        <TimeAgo date={f.last_changed_at} />
                      </td>
                      <td className="px-3 align-middle">
                        <StatusPill
                          tone={status.tone}
                          label={status.label}
                          compact
                        />
                      </td>
                      <td className="px-3 align-middle">
                        <div
                          className="text-[11.5px] text-ink-muted truncate max-w-[360px]"
                          title={f.last_run_summary ?? undefined}
                        >
                          {f.last_run_summary ?? "—"}
                        </div>
                      </td>
                      <td className="px-3 align-middle">
                        {lastDoc ? (
                          <a
                            href={lastDoc.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11.5px] text-accent-hi hover:underline num tabular-nums"
                            title={`${lastDoc.plan_name ?? lastDoc.gp_name ?? ""} · ${formatDate(lastDoc.created_at)}`}
                          >
                            {formatDate(lastDoc.created_at)}
                          </a>
                        ) : (
                          <span className="text-[11.5px] text-ink-faint">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card-surface p-4 text-[12px] text-ink-muted leading-relaxed">
        <div className="font-medium text-ink mb-1">Manual re-check</div>
        Each cron can be manually triggered by GETing{" "}
        <code className="text-[11.5px]">/api/cron/&lt;source&gt;?secret=$CRON_SECRET</code>.
        Vercel scheduled runs arrive with the{" "}
        <code className="text-[11.5px]">x-vercel-cron</code> header and the{" "}
        <code className="text-[11.5px]">VERCEL</code> env; both must match for
        the cron to trust the request.
        <div className="mt-3">
          <Link
            href="/plans"
            className="text-[12px] text-accent-hi hover:underline"
          >
            ← Back to /plans
          </Link>
        </div>
      </div>
    </div>
  );
}

function StatusPill({
  tone,
  label,
  count,
  compact = false,
}: {
  tone: "green" | "yellow" | "red";
  label: string;
  count?: number;
  compact?: boolean;
}) {
  const classes =
    tone === "green"
      ? "bg-emerald-100 text-emerald-800 border-emerald-200"
      : tone === "yellow"
      ? "bg-amber-100 text-amber-800 border-amber-200"
      : "bg-rose-100 text-rose-800 border-rose-200";
  const dot =
    tone === "green"
      ? "bg-emerald-600"
      : tone === "yellow"
      ? "bg-amber-500"
      : "bg-rose-600";
  return (
    <span
      className={
        "inline-flex items-center rounded-sm border text-[10.5px] font-medium " +
        (compact ? "h-5 px-1.5" : "h-6 px-2 text-[12px]") +
        " " +
        classes
      }
    >
      <span
        aria-hidden
        className={"inline-block h-1.5 w-1.5 rounded-full mr-1 " + dot}
      />
      {typeof count === "number" ? `${count} ` : ""}
      {label}
    </span>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={
        "text-left font-normal text-[12px] text-ink-faint px-3 h-9 bg-bg-subtle " +
        className
      }
    >
      {children}
    </th>
  );
}
