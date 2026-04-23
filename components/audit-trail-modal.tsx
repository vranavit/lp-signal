"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { ExternalLink, FileText, X } from "lucide-react";
import { getSourceInfo, type SourceInfo } from "@/app/actions/source-url";
import { formatDate } from "@/lib/utils";

/**
 * Reusable audit-trail modal. Click the trigger to open a modal showing
 * verbatim quote + source page + a (signed-URL) link to the backing PDF.
 * If the signed URL fails, the modal still renders with the public source_url
 * fallback and the quote — per Day 6 spec, partial UI ships rather than
 * blocking.
 *
 * Usage:
 *   <AuditTrailTrigger
 *     documentId={signal.document_id}
 *     sourcePage={signal.source_page}
 *     sourceQuote={signal.source_quote}
 *     label="Source"
 *   />
 */

export type AuditTrailTriggerProps = {
  documentId: string | null;
  sourcePage: number | null;
  sourceQuote: string | null;
  label?: string;
  inline?: boolean;
};

export function AuditTrailTrigger(props: AuditTrailTriggerProps) {
  const [open, setOpen] = React.useState(false);
  if (!props.documentId) return null;
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={
          props.inline
            ? "inline-flex items-center gap-1 text-[11px] text-ink-faint hover:text-accent-hi cursor-pointer"
            : "inline-flex items-center gap-1 h-6 px-1.5 text-[11px] text-ink-faint hover:text-ink border border-line hover:border-line-strong rounded-sm bg-bg transition-colors duration-150 cursor-pointer"
        }
        aria-label="View source"
      >
        <FileText className="h-3 w-3" strokeWidth={1.75} />
        <span>{props.label ?? "Source"}</span>
      </button>
      {open ? (
        <AuditTrailModal
          documentId={props.documentId}
          sourcePage={props.sourcePage}
          sourceQuote={props.sourceQuote}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function AuditTrailModal({
  documentId,
  sourcePage,
  sourceQuote,
  onClose,
}: {
  documentId: string;
  sourcePage: number | null;
  sourceQuote: string | null;
  onClose: () => void;
}) {
  const [info, setInfo] = React.useState<SourceInfo | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [fetchError, setFetchError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    getSourceInfo(documentId)
      .then((data) => {
        if (!alive) return;
        setInfo(data);
      })
      .catch((err) => {
        if (!alive) return;
        setFetchError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [documentId]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof window === "undefined") return null;

  const pdfHref = info?.signedUrl ?? info?.sourceUrl ?? null;
  const pdfLabel = info?.signedUrl
    ? "Open PDF (signed, 10 min)"
    : info?.sourceUrl
    ? "Open source PDF"
    : "PDF unavailable";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="card-surface w-full max-w-xl shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-3">
          <div>
            <div className="text-[13px] font-medium text-ink">
              Source provenance
            </div>
            <div className="mt-0.5 text-[11px] text-ink-faint">
              Every Allocus number is traceable to a verbatim quote.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 inline-flex items-center justify-center text-ink-faint hover:text-ink border border-transparent hover:border-line rounded-sm"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="px-4 py-3 space-y-3">
          <Field label="Document">
            <div className="text-[12.5px] text-ink">
              {info?.docType ? titleForDocType(info.docType) : "—"}
            </div>
            <div className="text-[11px] text-ink-faint mt-0.5">
              Document ID{" "}
              <span className="num tabular-nums">
                {documentId.slice(0, 8)}
              </span>
              {info?.meetingDate ? (
                <>
                  {" · as of "}
                  <span className="num tabular-nums">
                    {formatDate(info.meetingDate)}
                  </span>
                </>
              ) : null}
            </div>
          </Field>

          <Field label={sourcePage != null ? `Page ${sourcePage}` : "Source quote"}>
            {sourceQuote ? (
              <blockquote className="text-[12.5px] text-ink leading-snug border-l-2 border-accent pl-3 italic">
                &ldquo;{sourceQuote}&rdquo;
              </blockquote>
            ) : (
              <div className="text-[12px] text-ink-faint italic">
                No verbatim quote stored for this row.
              </div>
            )}
          </Field>

          {loading ? (
            <div className="text-[12px] text-ink-faint">Loading PDF link…</div>
          ) : fetchError ? (
            <div className="text-[12px] text-red-600">
              Failed to resolve source: {fetchError}
            </div>
          ) : pdfHref ? (
            <a
              href={pdfHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 h-8 px-3 text-[12px] bg-ink text-bg border border-ink hover:bg-ink/90 rounded-sm transition-colors duration-150"
            >
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
              {pdfLabel}
            </a>
          ) : (
            <div className="text-[12px] text-ink-faint">
              No PDF link available.
              {info?.signedUrlError ? (
                <span className="block mt-1 text-red-600">
                  Signed URL error: {info.signedUrlError}
                </span>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function titleForDocType(type: string): string {
  switch (type) {
    case "board_minutes":
      return "Board meeting / transaction report";
    case "cafr":
      return "Comprehensive Annual Financial Report (CAFR)";
    case "gp_press_release":
      return "GP press release";
    case "press_release":
      return "Press release";
    case "annual_report":
      return "Annual report";
    case "investment_policy":
      return "Investment policy statement";
    default:
      return type;
  }
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wide text-ink-faint mb-1">
        {label}
      </div>
      {children}
    </div>
  );
}
