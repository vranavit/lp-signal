"use client";

import { Inbox } from "lucide-react";

export function EmptyState({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="card-surface py-14 px-6 flex flex-col items-center justify-center gap-3 text-center">
      <div className="h-10 w-10 rounded-full bg-bg-panel border border-line flex items-center justify-center text-ink-faint">
        <Inbox className="h-5 w-5" strokeWidth={1.5} />
      </div>
      <div className="text-[14px] font-semibold text-ink">{title}</div>
      {description ? (
        <div className="text-[12.5px] text-ink-muted max-w-sm leading-relaxed">
          {description}
        </div>
      ) : null}
      {actions ? (
        <div className="mt-1 flex items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
