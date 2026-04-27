"use client";

import { Button } from "@/components/ui/button";

export default function ExploreError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="card-surface p-6 text-center space-y-3">
      <h2 className="text-[14px] font-semibold text-ink">
        Could not load Explore
      </h2>
      <p className="text-[12.5px] text-ink-muted max-w-md mx-auto">
        {error.message || "Something went wrong fetching signals."}
      </p>
      <Button type="button" variant="secondary" size="sm" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
