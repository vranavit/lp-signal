import Link from "next/link";
import { Quote } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatUSD, formatDate } from "@/lib/utils";
import { Wordmark } from "@/components/brand/wordmark";
import { DemoRequestButton } from "@/components/landing/demo-request-modal";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  // Auth check uses the cookie-bound server client so the top-right link
  // flips to "Go to dashboard" for returning users.
  const authClient = createSupabaseServerClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  // Data queries for the landing use the admin client. The numbers shown
  // (aggregate unfunded budget, signal count, pension count, CalSTRS
  // top-3 underweight, recent policy changes, one audit-trail example)
  // are explicitly designed to be public-facing proof — no per-user data.
  // Going through RLS would silently zero everything for unauth visitors.
  const db = createSupabaseAdminClient();

  const [stats, calstrsUnderweight, recentPolicyChanges, auditExample] =
    await Promise.all([
      loadLiveStats(db),
      loadCalstrsTop3Underweight(db),
      loadRecentPolicyChanges(db),
      loadAuditExample(db),
    ]);

  return (
    <div className="min-h-screen bg-white text-[rgb(10,10,10)]">
      <TopNav authenticated={!!user} />
      <main>
        <Hero stats={stats} />
        <ProofCards
          calstrsRows={calstrsUnderweight}
          policyChanges={recentPolicyChanges}
        />
        <HowItWorks />
        <AuditTrailProof example={auditExample} />
        <Faq />
      </main>
      <Footer />
    </div>
  );
}

// ─── data loaders ──────────────────────────────────────────────────────────

type LiveStats = {
  unfundedTotal: number;
  signalsCount: number;
  pensionsMonitored: number;
};

async function loadLiveStats(supabase: SupabaseClient): Promise<LiveStats> {
  try {
    const [{ data: allocRows }, { count: signalsCount }] = await Promise.all([
      supabase
        .from("pension_allocations")
        .select(
          "plan_id, asset_class, target_pct, actual_pct, total_plan_aum_usd, as_of_date",
        ),
      supabase
        .from("signals")
        .select("id", { count: "exact", head: true })
        .eq("seed_data", false)
        .not("validated_at", "is", null),
    ]);
    const rows = (allocRows ?? []) as Array<{
      plan_id: string;
      asset_class: string;
      target_pct: number;
      actual_pct: number | null;
      total_plan_aum_usd: number | null;
      as_of_date: string;
    }>;

    // Per-plan latest snapshot, sum underweight dollars, then sum across plans.
    const byPlan = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!byPlan.has(r.plan_id)) byPlan.set(r.plan_id, []);
      byPlan.get(r.plan_id)!.push(r);
    }
    let unfundedTotal = 0;
    for (const list of byPlan.values()) {
      list.sort((a, b) => b.as_of_date.localeCompare(a.as_of_date));
      const latestDate = list[0].as_of_date;
      const latest = list.filter((r) => r.as_of_date === latestDate);
      for (const r of latest) {
        if (r.actual_pct == null || r.total_plan_aum_usd == null) continue;
        const gap = Number(r.target_pct) - Number(r.actual_pct);
        if (gap <= 0) continue;
        unfundedTotal += Math.round((gap / 100) * Number(r.total_plan_aum_usd));
      }
    }
    return {
      unfundedTotal,
      signalsCount: signalsCount ?? 0,
      pensionsMonitored: byPlan.size,
    };
  } catch {
    // Fallback per Day 7.5 hard stop — use last-known stable numbers.
    return {
      unfundedTotal: 15_000_000_000,
      signalsCount: 75,
      pensionsMonitored: 7,
    };
  }
}

type UnderweightRow = {
  asset_class: string;
  target_pct: number;
  actual_pct: number;
  unfunded_usd: number;
};

async function loadCalstrsTop3Underweight(
  supabase: SupabaseClient,
): Promise<UnderweightRow[]> {
  const { data: plan } = await supabase
    .from("plans")
    .select("id")
    .eq("name", "CalSTRS")
    .maybeSingle();
  if (!plan) return [];
  const { data } = await supabase
    .from("pension_allocations")
    .select(
      "asset_class, target_pct, actual_pct, total_plan_aum_usd, as_of_date",
    )
    .eq("plan_id", plan.id)
    .order("as_of_date", { ascending: false });
  const rows = (data ?? []) as Array<{
    asset_class: string;
    target_pct: number;
    actual_pct: number | null;
    total_plan_aum_usd: number | null;
    as_of_date: string;
  }>;
  if (rows.length === 0) return [];
  const latestDate = rows[0].as_of_date;
  const latest = rows.filter((r) => r.as_of_date === latestDate);
  return latest
    .filter((r) => r.actual_pct != null && r.total_plan_aum_usd != null)
    .map((r) => {
      const gap = Number(r.target_pct) - Number(r.actual_pct!);
      return {
        asset_class: r.asset_class,
        target_pct: Number(r.target_pct),
        actual_pct: Number(r.actual_pct),
        unfunded_usd:
          gap > 0
            ? Math.round((gap / 100) * Number(r.total_plan_aum_usd!))
            : 0,
      };
    })
    .filter((r) => r.unfunded_usd > 0)
    .sort((a, b) => b.unfunded_usd - a.unfunded_usd)
    .slice(0, 3);
}

type PolicyChangeRow = {
  plan_name: string;
  asset_class: string;
  previous_target_pct: number;
  new_target_pct: number;
  change_direction: string;
  as_of_date_new: string;
};

async function loadRecentPolicyChanges(
  supabase: SupabaseClient,
): Promise<PolicyChangeRow[]> {
  const { data } = await supabase
    .from("allocation_policy_changes")
    .select(
      "asset_class, previous_target_pct, new_target_pct, change_direction, as_of_date_new, plan:plans(name)",
    )
    .order("as_of_date_new", { ascending: false })
    .order("detected_at", { ascending: false })
    .limit(3);
  return ((data ?? []) as unknown as Array<{
    asset_class: string;
    previous_target_pct: number;
    new_target_pct: number;
    change_direction: string;
    as_of_date_new: string;
    plan: { name: string } | null;
  }>).map((r) => ({
    plan_name: r.plan?.name ?? "(unknown plan)",
    asset_class: r.asset_class,
    previous_target_pct: Number(r.previous_target_pct),
    new_target_pct: Number(r.new_target_pct),
    change_direction: r.change_direction,
    as_of_date_new: r.as_of_date_new,
  }));
}

type AuditExample = {
  summary: string;
  source_quote: string;
  source_page: number | null;
  plan_name: string | null;
  doc_type: string;
  meeting_date: string | null;
  commitment_amount_usd: number | null;
  asset_class: string | null;
};

async function loadAuditExample(
  supabase: SupabaseClient,
): Promise<AuditExample | null> {
  // Prefer a pension-side board-minutes signal: crisp RESOLVED quote,
  // single fund, fits the narrative of the product.
  const { data } = await supabase
    .from("signals")
    .select(
      "summary, source_quote, source_page, asset_class, commitment_amount_usd, plan:plans(name), document:documents(document_type, meeting_date)",
    )
    .eq("seed_data", false)
    .eq("preliminary", false)
    .eq("signal_type", 1)
    .not("source_quote", "is", null)
    .gte("confidence", 0.9)
    .order("confidence", { ascending: false })
    .order("priority_score", { ascending: false })
    .limit(20);
  const rows = (data ?? []) as unknown as Array<{
    summary: string;
    source_quote: string;
    source_page: number | null;
    asset_class: string | null;
    commitment_amount_usd: number | null;
    plan: { name: string } | null;
    document: { document_type: string; meeting_date: string | null } | null;
  }>;
  const preferred =
    rows.find((r) => r.document?.document_type === "board_minutes") ?? rows[0];
  if (!preferred) return null;
  return {
    summary: preferred.summary,
    source_quote: preferred.source_quote,
    source_page: preferred.source_page,
    plan_name: preferred.plan?.name ?? null,
    doc_type: preferred.document?.document_type ?? "document",
    meeting_date: preferred.document?.meeting_date ?? null,
    commitment_amount_usd: preferred.commitment_amount_usd,
    asset_class: preferred.asset_class,
  };
}

// ─── sections ──────────────────────────────────────────────────────────────

function TopNav({ authenticated }: { authenticated: boolean }) {
  return (
    <header className="w-full border-b border-neutral-200 bg-white">
      <div className="mx-auto max-w-[1200px] px-6 h-16 flex items-center justify-between">
        <Wordmark size="md" />
        {authenticated ? (
          <Link
            href="/signals"
            className="text-[13px] text-neutral-700 hover:text-neutral-950 transition-colors"
          >
            Go to dashboard →
          </Link>
        ) : (
          <Link
            href="/login"
            className="text-[13px] text-neutral-700 hover:text-neutral-950 transition-colors"
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}

function Hero({ stats }: { stats: LiveStats }) {
  return (
    <section className="mx-auto max-w-[1200px] px-6 pt-24 pb-20 sm:pt-32 sm:pb-28">
      <div className="max-w-3xl">
        <h1
          className="text-[44px] sm:text-[60px] font-semibold text-neutral-950 leading-[1.02]"
          style={{ letterSpacing: "-0.03em" }}
        >
          LP intelligence for private markets fundraising.
        </h1>
        <p className="mt-6 text-[17px] sm:text-[19px] text-neutral-600 leading-snug max-w-2xl">
          Track allocation gaps, policy changes, and commitment signals across
          US public pensions in real time.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-3">
          <DemoRequestButton label="Request demo" />
          <a
            href="#how"
            className="inline-flex items-center h-9 px-4 text-[13px] text-neutral-700 hover:text-neutral-950 rounded-lg transition-colors"
          >
            See how it works ↓
          </a>
        </div>

        {/* Live stat strip */}
        <div className="mt-14 grid grid-cols-1 sm:grid-cols-3 gap-x-0 gap-y-4 sm:divide-x sm:divide-neutral-200 max-w-3xl">
          <LiveStat
            value={formatUSD(stats.unfundedTotal)}
            label="tracked unfunded budget"
          />
          <LiveStat
            value={String(stats.signalsCount)}
            label="commitment signals"
          />
          <LiveStat
            value={String(stats.pensionsMonitored)}
            label="pensions monitored"
          />
        </div>
      </div>
    </section>
  );
}

function LiveStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="sm:px-8 sm:first:pl-0 sm:last:pr-0">
      <div
        className="text-[28px] sm:text-[32px] font-semibold text-neutral-950 leading-none num tabular-nums"
        style={{ letterSpacing: "-0.03em" }}
      >
        {value}
      </div>
      <div className="mt-2 text-[12.5px] text-neutral-500">{label}</div>
    </div>
  );
}

function ProofCards({
  calstrsRows,
  policyChanges,
}: {
  calstrsRows: UnderweightRow[];
  policyChanges: PolicyChangeRow[];
}) {
  return (
    <section
      id="proof"
      className="mx-auto max-w-[1200px] px-6 py-20 sm:py-28 border-t border-neutral-200"
    >
      <div className="mb-12 max-w-3xl">
        <div className="text-[11.5px] uppercase tracking-[0.08em] text-neutral-500">
          What Allocus shows you
        </div>
        <h2
          className="mt-3 text-[30px] sm:text-[36px] font-semibold text-neutral-950 leading-tight"
          style={{ letterSpacing: "-0.03em" }}
        >
          Live data from live disclosures.
        </h2>
        <p className="mt-3 text-[15px] text-neutral-600 max-w-2xl">
          These panels are populated in real time from the Allocus database.
          Not screenshots — the numbers below update as pensions publish.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ProofCardAllocation rows={calstrsRows} />
        <ProofCardPolicy changes={policyChanges} />
      </div>
    </section>
  );
}

function ProofCardAllocation({ rows }: { rows: UnderweightRow[] }) {
  return (
    <div className="rounded-[12px] border border-neutral-200 bg-white overflow-hidden">
      <div className="px-5 py-4 border-b border-neutral-200">
        <div className="text-[15px] font-semibold text-neutral-950">
          Allocation gaps in real time
        </div>
        <div className="mt-1 text-[13px] text-neutral-600">
          See which pensions have budget to deploy right now.
        </div>
      </div>
      <div className="px-5 py-4">
        <div className="text-[11px] uppercase tracking-[0.08em] text-neutral-500 mb-3">
          CalSTRS — top 3 underweight asset classes
        </div>
        {rows.length === 0 ? (
          <div className="text-[13px] text-neutral-500">
            No underweight positions currently.
          </div>
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="text-neutral-500 border-b border-neutral-200">
                <ProofTh>Asset</ProofTh>
                <ProofTh className="text-right">Target</ProofTh>
                <ProofTh className="text-right">Actual</ProofTh>
                <ProofTh className="text-right">Gap</ProofTh>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.asset_class}
                  className="border-b border-neutral-100 last:border-b-0"
                >
                  <td className="py-2.5 text-neutral-950">{r.asset_class}</td>
                  <td className="py-2.5 text-right num tabular-nums text-neutral-900">
                    {r.target_pct}%
                  </td>
                  <td className="py-2.5 text-right num tabular-nums text-neutral-500">
                    {r.actual_pct}%
                  </td>
                  <td className="py-2.5 text-right num tabular-nums font-medium text-emerald-700">
                    +{formatUSD(r.unfunded_usd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="px-5 py-3 border-t border-neutral-200 bg-neutral-50">
        <Link
          href="/pensions/calstrs"
          className="text-[12.5px] text-indigo-700 hover:text-indigo-900 transition-colors"
        >
          See all CalSTRS allocations →
        </Link>
      </div>
    </div>
  );
}

function ProofCardPolicy({ changes }: { changes: PolicyChangeRow[] }) {
  return (
    <div className="rounded-[12px] border border-neutral-200 bg-white overflow-hidden">
      <div className="px-5 py-4 border-b border-neutral-200">
        <div className="text-[15px] font-semibold text-neutral-950">
          Know when targets change
        </div>
        <div className="mt-1 text-[13px] text-neutral-600">
          Pensions shifting allocation policy is a signal. We detect it
          automatically.
        </div>
      </div>
      <div className="px-5 py-4">
        <div className="text-[11px] uppercase tracking-[0.08em] text-neutral-500 mb-3">
          Most recent policy changes
        </div>
        {changes.length === 0 ? (
          <div className="text-[13px] text-neutral-500">
            No policy changes detected yet — new ones surface here
            automatically.
          </div>
        ) : (
          <ul className="divide-y divide-neutral-100 -mx-1">
            {changes.map((c, i) => {
              const sign =
                c.change_direction === "increase"
                  ? "↑"
                  : c.change_direction === "decrease"
                  ? "↓"
                  : "→";
              const delta = c.new_target_pct - c.previous_target_pct;
              const deltaTone =
                delta > 0.25
                  ? "text-emerald-700"
                  : delta < -0.25
                  ? "text-rose-700"
                  : "text-neutral-500";
              return (
                <li key={i} className="py-3 px-1 flex items-baseline gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-neutral-950 truncate">
                      {c.plan_name}
                    </div>
                    <div className="text-[11.5px] text-neutral-500 mt-0.5">
                      {c.asset_class} · as of {formatDate(c.as_of_date_new)}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="num tabular-nums text-[13px] text-neutral-900">
                      {c.previous_target_pct}% {sign} {c.new_target_pct}%
                    </div>
                    <div
                      className={`num tabular-nums text-[11.5px] mt-0.5 ${deltaTone}`}
                    >
                      {delta > 0 ? "+" : ""}
                      {delta.toFixed(1)}pp
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="px-5 py-3 border-t border-neutral-200 bg-neutral-50">
        <Link
          href="/signals?type=policy"
          className="text-[12.5px] text-indigo-700 hover:text-indigo-900 transition-colors"
        >
          Full policy change history →
        </Link>
      </div>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: "01",
      title: "Ingest",
      body: "We monitor every public disclosure from US pension funds and major GPs — board minutes, monthly transaction reports, annual CAFRs, press releases.",
    },
    {
      n: "02",
      title: "Extract",
      body: "Claude reads every document, extracts commitment signals, allocation targets, and policy changes. Every data point source-verified to the original disclosure.",
    },
    {
      n: "03",
      title: "Surface",
      body: "Your dashboard filters to your ICP. See which pensions have unfunded budget matched to your fund's size and strategy. One-click audit trail on every number.",
    },
  ];
  return (
    <section
      id="how"
      className="mx-auto max-w-[1200px] px-6 py-20 sm:py-28 border-t border-neutral-200"
    >
      <div className="mb-14 max-w-3xl">
        <div className="text-[11.5px] uppercase tracking-[0.08em] text-neutral-500">
          How it works
        </div>
        <h2
          className="mt-3 text-[30px] sm:text-[36px] font-semibold text-neutral-950 leading-tight"
          style={{ letterSpacing: "-0.03em" }}
        >
          From raw disclosure to targeted outreach list.
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-x-12 gap-y-10">
        {steps.map((s) => (
          <div key={s.n}>
            <div
              className="text-[36px] font-semibold text-neutral-300 leading-none num tabular-nums"
              style={{ letterSpacing: "-0.04em" }}
            >
              {s.n}
            </div>
            <div
              className="mt-4 text-[18px] font-semibold text-neutral-950"
              style={{ letterSpacing: "-0.02em" }}
            >
              {s.title}
            </div>
            <p className="mt-2.5 text-[14px] text-neutral-600 leading-relaxed">
              {s.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function AuditTrailProof({ example }: { example: AuditExample | null }) {
  return (
    <section className="mx-auto max-w-[1200px] px-6 py-20 sm:py-28 border-t border-neutral-200">
      <div className="mb-10 max-w-3xl">
        <div className="text-[11.5px] uppercase tracking-[0.08em] text-neutral-500">
          Credibility
        </div>
        <h2
          className="mt-3 text-[30px] sm:text-[36px] font-semibold text-neutral-950 leading-tight"
          style={{ letterSpacing: "-0.03em" }}
        >
          Every number is traceable.
        </h2>
      </div>

      {example ? (
        <div className="rounded-[12px] border border-neutral-200 bg-white overflow-hidden max-w-3xl">
          <div className="px-6 py-5 border-b border-neutral-200">
            <div className="text-[11px] uppercase tracking-[0.08em] text-neutral-500 mb-2">
              Signal
            </div>
            <div className="text-[15px] text-neutral-950 leading-snug">
              {example.summary}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-neutral-500">
              {example.asset_class ? <span>{example.asset_class}</span> : null}
              {example.commitment_amount_usd ? (
                <span className="num tabular-nums">
                  {formatUSD(example.commitment_amount_usd)}
                </span>
              ) : null}
            </div>
          </div>

          <div className="px-6 py-5 bg-neutral-50 border-b border-neutral-200">
            <div className="text-[11px] uppercase tracking-[0.08em] text-neutral-500 mb-2">
              Source quote
              {example.source_page ? ` · page ${example.source_page}` : ""}
            </div>
            <div className="flex items-start gap-3">
              <Quote
                className="h-4 w-4 mt-0.5 text-neutral-400 shrink-0"
                strokeWidth={1.5}
              />
              <blockquote className="text-[14px] text-neutral-800 leading-relaxed italic">
                {example.source_quote}
              </blockquote>
            </div>
          </div>

          <div className="px-6 py-4">
            <div className="text-[12px] text-neutral-500">
              From:{" "}
              <span className="text-neutral-800">
                {example.plan_name ?? "—"}
              </span>
              {" · "}
              <span className="text-neutral-800">
                {prettyDocType(example.doc_type)}
              </span>
              {example.meeting_date ? (
                <>
                  {" · "}
                  <span className="num tabular-nums text-neutral-800">
                    {formatDate(example.meeting_date)}
                  </span>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-[12px] border border-neutral-200 bg-white p-6 text-[13px] text-neutral-500 max-w-3xl">
          Example unavailable.
        </div>
      )}

      <p className="mt-6 max-w-3xl text-[14px] text-neutral-600 leading-relaxed">
        Click any number anywhere in Allocus to see the original source
        document. No extrapolation, no inference — every data point verified to
        the page.
      </p>
    </section>
  );
}

function prettyDocType(t: string): string {
  switch (t) {
    case "board_minutes":
      return "Board resolution / minutes";
    case "cafr":
      return "Annual Comprehensive Financial Report";
    case "gp_press_release":
      return "GP press release";
    case "press_release":
      return "Press release";
    case "annual_report":
      return "Annual report";
    case "investment_policy":
      return "Investment policy statement";
    default:
      return t;
  }
}

function Faq() {
  const items: { q: string; a: string }[] = [
    {
      q: "How many pensions do you cover?",
      a: "Today, 8 US public pensions with transaction data and 6 with allocation data. New pensions added weekly. Target: 50+ pensions by end of Q3 2026.",
    },
    {
      q: "Where does the data come from?",
      a: "Every signal is sourced from public disclosures: SEC filings, state comptroller reports, pension board minutes, GP press releases, and Comprehensive Annual Financial Reports (CAFRs). Every number in Allocus links back to the original source document with a page citation.",
    },
    {
      q: "How fresh is the data?",
      a: "GP press releases: same-day ingestion. Monthly pension transaction reports: within 24 hours of publication. Annual CAFRs: within a week of release. Allocation policy changes: detected on the next CAFR ingestion automatically.",
    },
    {
      q: "Who is this for?",
      a: "Private markets IR teams, fund managers, and placement agents who need to know which LPs have budget to deploy — filtered to their specific ICP (asset class, check size, geography).",
    },
    {
      q: "How do you compare to Preqin or Pitchbook?",
      a: "Preqin and Pitchbook show historical commitments. Allocus shows forward-looking signals: who has unfunded budget right now, who's changing their policy, who just announced a close. Different layer. Complementary, not redundant.",
    },
    {
      q: "Can I see a demo?",
      a: "Yes. Request one via the button at the top. Current beta is closed to ~5 design partners. Access is manual for now.",
    },
  ];

  return (
    <section
      id="faq"
      className="mx-auto max-w-[1200px] px-6 py-20 sm:py-28 border-t border-neutral-200"
    >
      <div className="mb-10 max-w-3xl">
        <div className="text-[11.5px] uppercase tracking-[0.08em] text-neutral-500">
          FAQ
        </div>
        <h2
          className="mt-3 text-[30px] sm:text-[36px] font-semibold text-neutral-950 leading-tight"
          style={{ letterSpacing: "-0.03em" }}
        >
          Good questions people ask.
        </h2>
      </div>

      <div className="max-w-3xl rounded-[12px] border border-neutral-200 bg-white overflow-hidden divide-y divide-neutral-200">
        {items.map((it) => (
          <details key={it.q} className="group">
            <summary className="cursor-pointer list-none px-6 py-5 flex items-center justify-between gap-4 hover:bg-neutral-50 transition-colors">
              <span className="text-[15px] font-medium text-neutral-950">
                {it.q}
              </span>
              <span
                aria-hidden
                className="shrink-0 text-[14px] text-neutral-400 transition-transform group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <div className="px-6 pb-5 text-[14px] text-neutral-600 leading-relaxed">
              {it.a}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-neutral-200 bg-white">
      <div className="mx-auto max-w-[1200px] px-6 py-8 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Wordmark size="sm" />
          <span className="text-[12px] text-neutral-500">
            © {new Date().getFullYear()} Allocus · Closed beta
          </span>
        </div>
        <div className="flex items-center gap-4">
          <DemoRequestButton size="sm" variant="outline" label="Request demo" />
          <a
            href="mailto:vitek.vrana@bloorcapital.com?subject=Allocus%20demo"
            className="text-[12.5px] text-neutral-600 hover:text-neutral-950 transition-colors"
          >
            vitek.vrana@bloorcapital.com
          </a>
        </div>
      </div>
    </footer>
  );
}

// ProofCard table-header cell — keeps all four columns rhythmic.
function ProofTh({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`text-left font-normal text-[11px] uppercase tracking-[0.06em] text-neutral-500 py-2 ${className}`}
    >
      {children}
    </th>
  );
}
