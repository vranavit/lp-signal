import type { PipelineCounts } from "./shared";

/**
 * Process section. White background with a faint horizontal-rule backdrop
 * — gives the section the feel of ruled financial-report paper without
 * competing with the content. Step numbers are oversized Instrument Serif
 * to anchor each column vertically.
 */
export function HowItWorks({ pipeline }: { pipeline: PipelineCounts }) {
  const steps = [
    {
      n: "01",
      title: "Ingest",
      body:
        "We monitor every public disclosure from US public pension funds and major GPs. Board minutes, monthly transaction reports, comprehensive annual financial reports, press releases. Automated daily.",
      chipValue: pipeline.documents.toLocaleString("en-US"),
      chipLabel: "documents processed",
    },
    {
      n: "02",
      title: "Extract",
      body:
        "Claude reads every document. Extracts commitment signals, allocation targets, and policy changes. Every data point gets a confidence score and source citation.",
      chipValue: `${pipeline.signals} + ${pipeline.allocations}`,
      chipLabel: "signals + allocations",
    },
    {
      n: "03",
      title: "Surface",
      body:
        "Your dashboard filters to your fund's ICP. You see only pensions with budget to deploy, filtered to your asset class, check size, and geography.",
      chipValue: String(pipeline.policyChanges),
      chipLabel: "policy changes flagged",
    },
  ];
  return (
    <section
      id="how"
      className="how-surface relative bg-white border-t border-neutral-200"
    >
      <div className="relative mx-auto max-w-[1200px] px-6 py-20 sm:py-24">
        <div className="mb-14 max-w-3xl">
          <div
            className="text-[11px] uppercase text-neutral-500 font-medium"
            style={{ letterSpacing: "0.1em" }}
          >
            How it works
          </div>
          <h2
            className="mt-3 font-serif font-normal text-navy text-[40px] sm:text-[48px] leading-[1.02]"
            style={{ letterSpacing: "-0.02em" }}
          >
            How Allocus works.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border-t border-neutral-200">
          {steps.map((s, i) => (
            <div
              key={s.n}
              className={
                "pt-10 pb-4 md:px-8 first:md:pl-0 last:md:pr-0 " +
                (i < steps.length - 1
                  ? "md:border-r border-neutral-200"
                  : "")
              }
            >
              <div
                className="font-serif font-normal text-navy text-[64px] sm:text-[72px] leading-none tabular-nums"
                style={{ letterSpacing: "-0.03em" }}
              >
                {s.n}
              </div>

              <div className="h-8" aria-hidden />

              <div
                className="text-[20px] font-semibold text-navy"
                style={{ letterSpacing: "-0.01em" }}
              >
                {s.title}
              </div>

              <div className="h-4" aria-hidden />

              <p className="text-[15px] text-neutral-600 leading-[1.7] max-w-[320px]">
                {s.body}
              </p>

              <div className="h-8" aria-hidden />

              <div className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] border border-neutral-200 bg-neutral-50">
                <span className="font-mono tabular-nums text-[12.5px] text-navy font-semibold">
                  {s.chipValue}
                </span>
                <span className="text-[11.5px] text-neutral-600">
                  {s.chipLabel}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
