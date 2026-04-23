"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function OutreachError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[/outreach] route error:", error);
  }, [error]);

  return (
    <div className="card-surface py-16 px-6 flex flex-col items-center justify-center gap-4 text-center">
      <div className="h-11 w-11 rounded-full bg-red-50 border border-red-200 flex items-center justify-center text-red-700 dark:bg-red-950/40 dark:border-red-900 dark:text-red-400">
        <AlertTriangle className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <div>
        <div className="text-[14px] font-semibold text-ink">
          Outreach failed to load
        </div>
        <div className="mt-1 text-[12.5px] text-ink-muted max-w-md leading-relaxed">
          {error.message || "An unexpected error occurred."}
          {error.digest ? (
            <span className="block mt-1 font-mono text-[11px] text-ink-faint">
              digest: {error.digest}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={reset}>
          <RotateCw className="h-3.5 w-3.5" strokeWidth={1.75} />
          Try again
        </Button>
      </div>
    </div>
  );
}
