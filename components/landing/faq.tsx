export function Faq() {
  const items: { q: string; a: string }[] = [
    {
      q: "How many pensions do you cover?",
      a: "Today, 8 US public pensions with transaction data and 6 with allocation data. New pensions added weekly. Target: 50+ pensions by end of Q3 2026.",
    },
    {
      q: "Where does the data come from?",
      a: "Every signal is sourced from public disclosures: state comptroller reports, pension board minutes, GP press releases, and Comprehensive Annual Financial Reports (CAFRs). Every number in Allocus links back to the original source document with a page citation.",
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
  const leftCol = items.slice(0, 3);
  const rightCol = items.slice(3);

  return (
    <section id="faq" className="bg-white border-t border-neutral-200">
      <div className="mx-auto max-w-[1200px] px-6 py-20 sm:py-24">
        <div className="mb-12 max-w-3xl">
          <div
            className="text-[11px] uppercase text-neutral-500 font-medium"
            style={{ letterSpacing: "0.1em" }}
          >
            FAQ
          </div>
          <h2
            className="mt-3 font-serif font-normal text-navy text-[40px] sm:text-[48px] leading-[1.02]"
            style={{ letterSpacing: "-0.02em" }}
          >
            Good questions people ask.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FaqColumn items={leftCol} />
          <FaqColumn items={rightCol} />
        </div>
      </div>
    </section>
  );
}

function FaqColumn({ items }: { items: { q: string; a: string }[] }) {
  return (
    <div className="rounded-[12px] border border-neutral-200 bg-white overflow-hidden divide-y divide-neutral-200">
      {items.map((it) => (
        <details key={it.q} className="group">
          <summary className="cursor-pointer list-none px-5 py-4 flex items-center justify-between gap-4 hover:bg-neutral-50 transition-colors">
            <span className="text-[14px] font-semibold text-navy">{it.q}</span>
            <span
              aria-hidden
              className="shrink-0 text-[14px] text-neutral-400 transition-transform group-open:rotate-45"
            >
              +
            </span>
          </summary>
          <div className="px-5 pb-4 text-[13.5px] text-neutral-700 leading-relaxed">
            {it.a}
          </div>
        </details>
      ))}
    </div>
  );
}
