import Link from "next/link";
import { CheckCircle2, FileText } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatUSD, formatDate } from "@/lib/utils";
import { DemoRequestButton } from "@/components/landing/demo-request-modal";
import {
  PRIVATE_MARKETS_CLASSES,
  privateMarketsUnfundedUsd,
  unfundedUsd,
} from "@/lib/relevance/unfunded";

export const dynamic = "force-dynamic";

type LandingAlloc = {
  asset_class: string;
  target_pct: number;
  actual_pct: number | null;
  total_plan_aum_usd: number | null;
  as_of_date: string;
};

export default async function LandingPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Live CalSTRS snapshot for the proof section — real data beats a static
  // screenshot, and the numbers come straight from pension_allocations.
  const calstrs = await loadCalstrsSnapshot(supabase);

  return (
    <div className="min-h-screen bg-bg text-ink">
      <TopBar authenticated={!!user} />
      <main>
        <Hero />
        <Problem />
        <ProofSection calstrs={calstrs} />
        <Features />
        <SecondaryCta />
      </main>
      <Footer />
    </div>
  );
}

async function loadCalstrsSnapshot(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
): Promise<{
  planName: string;
  latestAsOf: string | null;
  totalAum: number | null;
  rows: LandingAlloc[];
  unfundedTotal: number;
  perClass: { asset_class: string; unfunded_usd: number }[];
} | null> {
  const { data: plan } = await supabase
    .from("plans")
    .select("id, name")
    .eq("name", "CalSTRS")
    .maybeSingle();
  if (!plan) return null;

  const { data } = await supabase
    .from("pension_allocations")
    .select("asset_class, target_pct, actual_pct, total_plan_aum_usd, as_of_date")
    .eq("plan_id", plan.id)
    .order("as_of_date", { ascending: false })
    .order("asset_class", { ascending: true });
  const all = (data ?? []) as LandingAlloc[];
  if (all.length === 0) return null;
  const latestAsOf = all[0].as_of_date;
  const latest = all.filter((r) => r.as_of_date === latestAsOf);
  const totalAum =
    latest.find((r) => r.total_plan_aum_usd)?.total_plan_aum_usd ?? null;
  const unfundedTotal = privateMarketsUnfundedUsd(latest);
  const perClass = latest
    .filter((r) =>
      (PRIVATE_MARKETS_CLASSES as readonly string[]).includes(r.asset_class),
    )
    .map((r) => ({ asset_class: r.asset_class, unfunded_usd: unfundedUsd(r) }))
    .filter((r) => r.unfunded_usd > 0)
    .sort((a, b) => b.unfunded_usd - a.unfunded_usd);
  return {
    planName: plan.name,
    latestAsOf,
    totalAum,
    rows: latest,
    unfundedTotal,
    perClass,
  };
}

function TopBar({ authenticated }: { authenticated: boolean }) {
  return (
    <header className="w-full border-b border-line bg-bg-subtle">
      <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block h-[14px] w-[14px] border border-accent bg-accent/10"
          />
          <span className="text-[14px] font-semibold tracking-tightish text-ink">
            Allocus
          </span>
          <span className="ml-2 text-[11px] text-ink-faint uppercase tracking-wide">
            Closed beta
          </span>
        </div>
        <div className="flex items-center gap-3">
          {authenticated ? (
            <Link
              href="/signals"
              className="text-[12.5px] text-ink-muted hover:text-ink"
            >
              Go to dashboard →
            </Link>
          ) : (
            <Link
              href="/login"
              className="text-[12.5px] text-ink-muted hover:text-ink"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="mx-auto max-w-6xl px-6 pt-16 pb-14 sm:pt-24 sm:pb-20">
      <div className="max-w-3xl">
        <h1 className="text-[32px] sm:text-[44px] font-semibold tracking-tightish text-ink leading-[1.05]">
          LP intelligence for private markets fundraising.
        </h1>
        <p className="mt-5 text-[15px] sm:text-[17px] text-ink-muted leading-snug max-w-2xl">
          See which pensions have unfunded budget for your fund. Track
          allocation gaps across US public pensions in real time.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <DemoRequestButton />
          <a
            href="#proof"
            className="inline-flex items-center h-9 px-4 text-[13px] text-ink-muted hover:text-ink border border-line hover:border-line-strong rounded-sm transition-colors"
          >
            See a live example ↓
          </a>
        </div>
      </div>
    </section>
  );
}

function Problem() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-12 sm:py-16 border-t border-line">
      <div className="max-w-3xl space-y-5 text-[14.5px] text-ink-muted leading-relaxed">
        <p>
          IR teams fly blind when fundraising. Preqin is quarterly, LinkedIn
          is noise, and manually tracking every pension&apos;s disclosures is
          impossible.
        </p>
        <p>
          Allocus watches US public pension commitments, allocation targets,
          and policy changes in real time — and tells you specifically which
          LPs have budget matched to your strategy.
        </p>
        <p>
          Fresh signals. Source-verified. Built for mid-market private markets
          fundraising.
        </p>
      </div>
    </section>
  );
}

function ProofSection({
  calstrs,
}: {
  calstrs: Awaited<ReturnType<typeof loadCalstrsSnapshot>>;
}) {
  return (
    <section
      id="proof"
      className="mx-auto max-w-6xl px-6 py-12 sm:py-16 border-t border-line"
    >
      <div className="max-w-3xl mb-6">
        <div className="text-[11px] uppercase tracking-wide text-ink-faint">
          Live example
        </div>
        <h2 className="mt-1 text-[22px] sm:text-[26px] font-semibold tracking-tightish text-ink">
          CalSTRS currently has{" "}
          <span className="num tabular-nums">
            {calstrs ? formatUSD(calstrs.unfundedTotal) : "$0"}
          </span>{" "}
          of unfunded private markets budget.
        </h2>
        <p className="mt-2 text-[13.5px] text-ink-muted leading-snug">
          Computed from CalSTRS&apos; most recent CAFR policy table. Each row
          below is extracted and source-verified. This view is live — no
          screenshots.
        </p>
      </div>

      {calstrs ? (
        <CalstrsSnippet snap={calstrs} />
      ) : (
        <div className="card-surface p-6 text-[13px] text-ink-muted">
          Live snapshot unavailable.
        </div>
      )}
    </section>
  );
}

function CalstrsSnippet({
  snap,
}: {
  snap: NonNullable<Awaited<ReturnType<typeof loadCalstrsSnapshot>>>;
}) {
  return (
    <div className="card-surface overflow-hidden">
      {/* Hero numbers */}
      <div className="px-5 py-4 border-b border-line flex items-start justify-between gap-6 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-ink-faint">
            CalSTRS
          </div>
          <div className="num tabular-nums text-[28px] font-semibold text-ink leading-none mt-1">
            {formatUSD(snap.unfundedTotal)}
          </div>
          <div className="text-[11px] text-ink-faint mt-1">
            unfunded private markets budget · as of{" "}
            {formatDate(snap.latestAsOf)} · AUM {formatUSD(snap.totalAum)}
          </div>
        </div>
        {snap.perClass.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {snap.perClass.map((b) => (
              <div
                key={b.asset_class}
                className="border border-line rounded-sm px-2.5 py-1.5 min-w-[88px]"
              >
                <div className="text-[10.5px] text-ink-faint uppercase tracking-wide">
                  {b.asset_class}
                </div>
                <div className="num tabular-nums text-[13px] text-ink font-medium leading-tight">
                  {formatUSD(b.unfunded_usd)}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* Gap table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line text-ink-faint">
              <th className="text-left font-normal text-[12px] px-4 h-9 bg-bg-subtle">
                Asset Class
              </th>
              <th className="text-right font-normal text-[12px] px-4 h-9 bg-bg-subtle w-[110px]">
                Target %
              </th>
              <th className="text-right font-normal text-[12px] px-4 h-9 bg-bg-subtle w-[100px]">
                Actual %
              </th>
              <th className="text-right font-normal text-[12px] px-4 h-9 bg-bg-subtle w-[100px]">
                Gap (pp)
              </th>
              <th className="text-right font-normal text-[12px] px-4 h-9 bg-bg-subtle w-[130px]">
                $ Gap
              </th>
            </tr>
          </thead>
          <tbody>
            {snap.rows.map((r, i) => {
              const gapPct =
                r.actual_pct != null ? r.target_pct - r.actual_pct : null;
              const gapUsd =
                gapPct != null && snap.totalAum
                  ? Math.round((gapPct / 100) * snap.totalAum)
                  : null;
              return (
                <tr
                  key={`${r.asset_class}-${i}`}
                  className="h-11 border-b border-line last:border-b-0 odd:bg-black/[0.015] dark:odd:bg-white/[0.02]"
                >
                  <td className="px-4 align-middle text-ink">
                    {r.asset_class}
                  </td>
                  <td className="px-4 align-middle text-right num tabular-nums text-ink">
                    {r.target_pct}%
                  </td>
                  <td className="px-4 align-middle text-right num tabular-nums text-ink-muted">
                    {r.actual_pct != null ? `${r.actual_pct}%` : "—"}
                  </td>
                  <td className="px-4 align-middle text-right">
                    {gapPct != null ? (
                      <span
                        className={
                          "num tabular-nums font-medium " +
                          (gapPct > 0.5
                            ? "text-green-700 dark:text-green-400"
                            : gapPct < -0.5
                            ? "text-red-700 dark:text-red-400"
                            : "text-ink-muted")
                        }
                      >
                        {gapPct > 0 ? "+" : ""}
                        {gapPct.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </td>
                  <td className="px-4 align-middle text-right">
                    {gapUsd != null ? (
                      <span
                        className={
                          "num tabular-nums " +
                          (gapUsd > 0
                            ? "text-green-700 dark:text-green-400"
                            : gapUsd < 0
                            ? "text-red-700 dark:text-red-400"
                            : "text-ink-muted")
                        }
                      >
                        {gapUsd > 0 ? "+" : gapUsd < 0 ? "−" : ""}
                        {formatUSD(Math.abs(gapUsd))}
                      </span>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-5 py-3 border-t border-line flex items-center justify-between gap-4 flex-wrap">
        <div className="text-[12px] text-ink-faint flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
          Every row traceable to a verbatim quote in the source CAFR.
        </div>
        <DemoRequestButton
          size="sm"
          variant="accent"
          label="Request full access"
        />
      </div>
    </div>
  );
}

function Features() {
  const items = [
    "Fresh commitment signals from 8+ pension funds",
    "Policy change detection — know when a pension raises their PE target",
    "Allocation gap tracking with dollar-denominated unfunded budget",
    "Every number source-verified with one-click audit trail",
  ];
  return (
    <section className="mx-auto max-w-6xl px-6 py-12 sm:py-16 border-t border-line">
      <h2 className="text-[22px] sm:text-[24px] font-semibold tracking-tightish text-ink max-w-2xl">
        What Allocus does
      </h2>
      <ul className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-3xl">
        {items.map((t) => (
          <li
            key={t}
            className="flex items-start gap-2.5 text-[14px] text-ink leading-snug"
          >
            <CheckCircle2
              className="h-4 w-4 mt-0.5 text-accent shrink-0"
              strokeWidth={1.75}
            />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SecondaryCta() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-14 sm:py-20 border-t border-line">
      <div className="max-w-2xl">
        <h2 className="text-[22px] sm:text-[26px] font-semibold tracking-tightish text-ink leading-snug">
          Want to see your firm&apos;s LP pipeline? Book 15 minutes.
        </h2>
        <p className="mt-3 text-[13.5px] text-ink-muted">
          I&apos;ll walk you through live data for pensions that match your
          asset class and check size, and we&apos;ll talk about whether
          Allocus fits your fundraising workflow.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <DemoRequestButton label="Book a demo" />
          <a
            href="mailto:vitek.vrana@bloorcapital.com?subject=Allocus%20demo"
            className="inline-flex items-center h-9 px-4 text-[13px] text-ink-muted hover:text-ink border border-line hover:border-line-strong rounded-sm transition-colors"
          >
            Or email vitek.vrana@bloorcapital.com
          </a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-line bg-bg-subtle">
      <div className="mx-auto max-w-6xl px-6 py-6 flex items-center justify-between gap-3 flex-wrap text-[11.5px] text-ink-faint">
        <div>Allocus is in closed beta. Built by Vitek Vrana.</div>
        <div>© {new Date().getFullYear()} Allocus</div>
      </div>
    </footer>
  );
}
