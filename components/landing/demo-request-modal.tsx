"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { submitDemoRequest } from "@/app/actions/demo-request";

/**
 * Small email-capture dialog for the landing page. Client-only; portals to
 * document.body for stacking above the page. Submits via the server action
 * in app/actions/demo-request.ts. Shows inline success / error states
 * without navigating.
 */
export function DemoRequestButton({
  className,
  size = "lg",
  label = "Request demo",
  variant = "accent",
}: {
  className?: string;
  size?: "default" | "sm" | "lg";
  label?: string;
  variant?: "accent" | "default" | "secondary" | "outline";
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={() => setOpen(true)}
        className={className}
      >
        {label}
      </Button>
      {open ? <DemoRequestModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function DemoRequestModal({ onClose }: { onClose: () => void }) {
  const [isPending, startTransition] = React.useTransition();
  const [status, setStatus] = React.useState<
    | { kind: "idle" }
    | { kind: "ok" }
    | { kind: "err"; text: string }
  >({ kind: "idle" });

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fd = new FormData(form);
    startTransition(async () => {
      const res = await submitDemoRequest(fd);
      if (res.ok) setStatus({ kind: "ok" });
      else setStatus({ kind: "err", text: res.error });
    });
  }

  if (typeof window === "undefined") return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="card-surface w-full max-w-md shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-line flex items-center justify-between gap-3">
          <div className="text-[14px] font-semibold text-ink">
            Request an Allocus demo
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

        {status.kind === "ok" ? (
          <div className="px-5 py-6">
            <div className="text-[13px] text-ink">
              Thanks — I&apos;ll be in touch within 48 hours.
            </div>
            <div className="mt-1 text-[12px] text-ink-muted">
              You can close this window.
            </div>
            <div className="mt-4">
              <Button type="button" variant="secondary" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="px-5 py-4 space-y-3">
            <div>
              <label
                htmlFor="demo-email"
                className="text-[12px] text-ink-muted block mb-1.5"
              >
                Work email
              </label>
              <Input
                id="demo-email"
                name="email"
                type="email"
                placeholder="you@firm.com"
                required
                autoFocus
              />
            </div>
            {status.kind === "err" ? (
              <div className="text-[12px] text-red-600">{status.text}</div>
            ) : (
              <div className="text-[11.5px] text-ink-faint">
                I&apos;ll reply personally within 48 hours. No drip marketing.
              </div>
            )}
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" variant="accent" disabled={isPending}>
                {isPending ? "Sending…" : "Request demo"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
