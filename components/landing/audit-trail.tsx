import { formatUSD, formatDate } from "@/lib/utils";
import type { AuditExample } from "./shared";

export function AuditTrail({ example }: { example: AuditExample | null }) {
  return (
    <section className="bg-neutral-100 border-t border-neutral-200">
      <div className="mx-auto max-w-[1200px] px-6 py-20 sm:py-24">
        <div className="mb-12 max-w-3xl">
          <div
            className="text-[11px] uppercase text-neutral-500 font-medium"
            style={{ letterSpacing: "0.1em" }}
          >
            Source-verified
          </div>
          <h2
            className="mt-3 font-serif font-normal text-navy text-[40px] sm:text-[48px] leading-[1.02]"
            style={{ letterSpacing: "-0.02em" }}
          >
            Every number is traceable.
          </h2>
          <p className="mt-4 text-[15px] text-neutral-600 leading-snug">
            Click any figure in Allocus to see the verbatim language from the
            original disclosure — no inference, no paraphrase.
          </p>
        </div>

        {example ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* LEFT: structured record */}
            <div className="rounded-[12px] border border-neutral-200 bg-white overflow-hidden">
              <div className="px-5 py-3 border-b border-neutral-200 bg-neutral-50 flex items-center justify-between">
                <span
                  className="font-mono text-[10.5px] uppercase text-neutral-500"
                  style={{ letterSpacing: "0.1em" }}
                >
                  Signal record
                </span>
                <span
                  className="font-mono text-[10.5px] uppercase text-neutral-500"
                  style={{ letterSpacing: "0.1em" }}
                >
                  Extracted
                </span>
              </div>
              <div className="px-6 py-6 space-y-4">
                <div className="text-[15px] text-neutral-950 leading-snug">
                  {example.summary}
                </div>
                <dl className="grid grid-cols-2 gap-y-3 gap-x-6 text-[12.5px] border-t border-neutral-100 pt-4">
                  <FieldRow label="Plan" value={example.plan_name ?? "—"} />
                  <FieldRow
                    label="Asset class"
                    value={example.asset_class ?? "—"}
                  />
                  <FieldRow
                    label="Commitment"
                    value={
                      example.commitment_amount_usd
                        ? formatUSD(example.commitment_amount_usd)
                        : "—"
                    }
                    mono
                    emphasis
                  />
                  <FieldRow
                    label="Meeting date"
                    value={
                      example.meeting_date
                        ? formatDate(example.meeting_date)
                        : "—"
                    }
                    mono
                  />
                </dl>
              </div>
            </div>

            {/* RIGHT: source quote */}
            <div className="rounded-[12px] border border-neutral-200 bg-white overflow-hidden">
              <div className="px-5 py-3 border-b border-neutral-200 bg-neutral-50 flex items-center justify-between">
                <span
                  className="font-mono text-[10.5px] uppercase text-neutral-500"
                  style={{ letterSpacing: "0.1em" }}
                >
                  Source document
                </span>
                <span
                  className="font-mono text-[10.5px] uppercase text-neutral-500"
                  style={{ letterSpacing: "0.1em" }}
                >
                  {example.source_page
                    ? `p. ${example.source_page}`
                    : "source"}
                </span>
              </div>
              <div className="px-6 py-6">
                <blockquote
                  className="font-serif italic text-navy text-[20px] sm:text-[22px] leading-[1.5] pl-5"
                  style={{
                    borderLeft: "4px solid #0f1b3d",
                    letterSpacing: "-0.005em",
                  }}
                >
                  {example.source_quote}
                </blockquote>
                <div className="mt-5 text-[11.5px] text-neutral-500">
                  {prettyDocType(example.doc_type)}
                  {example.plan_name ? ` · ${example.plan_name}` : ""}
                  {example.meeting_date
                    ? ` · ${formatDate(example.meeting_date)}`
                    : ""}
                </div>
              </div>
              <div className="px-6 py-3 border-t border-neutral-200 bg-neutral-50 flex items-center justify-between">
                <span className="text-[11px] text-neutral-500">
                  Every row links to the original PDF with one click.
                </span>
                <span className="text-[11px] text-navy font-medium">
                  Inspect →
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-[12px] border border-neutral-200 bg-white p-6 text-[13px] text-neutral-500">
            Example unavailable.
          </div>
        )}
      </div>
    </section>
  );
}

function FieldRow({
  label,
  value,
  mono = false,
  emphasis = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div>
      <dt
        className="text-[10.5px] uppercase text-neutral-500"
        style={{ letterSpacing: "0.08em" }}
      >
        {label}
      </dt>
      <dd
        className={`${mono ? "font-mono tabular-nums" : ""} ${emphasis ? "text-navy font-semibold" : "text-neutral-900"} mt-1 text-[13.5px]`}
      >
        {value}
      </dd>
    </div>
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
