import Link from "next/link";
import { ChevronLeft } from "lucide-react";

// Renders when page.tsx calls notFound() because the slug
// doesn't resolve to any plan in the database. Mirrors the
// "data ingestion in progress" empty-state aesthetic of the
// main page so the experience reads as part of the app, not a
// generic 404.
export default function PensionPageNotFound() {
  return (
    <div className="space-y-4 max-w-5xl">
      <Link
        href="/plans"
        className="inline-flex items-center gap-1 text-[12px] text-ink-muted hover:text-ink"
      >
        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
        Plans
      </Link>

      <section className="card-surface py-16 px-6 flex flex-col items-center justify-center gap-4 text-center">
        <div className="h-10 w-10 rounded-full bg-bg-panel border border-line flex items-center justify-center">
          <span
            aria-hidden
            className="inline-block h-2 w-2 rounded-full bg-neutral-400"
          />
        </div>
        <div>
          <div className="text-[14px] font-semibold text-ink">
            Plan not found
          </div>
          <div className="mt-1.5 text-[12.5px] text-ink-muted max-w-md leading-relaxed mx-auto">
            We don&apos;t have data for this pension plan. The slug
            in the URL may be misspelled or the plan may not yet be
            tracked.
          </div>
        </div>
        <Link
          href="/plans"
          className="text-[12px] text-accent-hi hover:underline"
        >
          Browse all plans
        </Link>
      </section>
    </div>
  );
}
