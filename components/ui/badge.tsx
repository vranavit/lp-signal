import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 border px-1.5 h-[18px] text-[10.5px] font-medium rounded-sm whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-line text-ink-muted bg-bg-panel",
        t1: "border-accent/40 text-accent bg-accent/10 dark:text-accent-hi",
        t2: "border-line-strong text-ink bg-bg-panel",
        t3: "border-line text-ink-faint bg-bg-subtle",
        seed: "border-line text-ink-faint bg-bg",
        hi: "border-pri-hi/40 text-pri-hi bg-pri-hi/10",
        mid: "border-line-strong text-ink bg-bg-panel",
        lo: "border-line text-ink-faint bg-bg-subtle",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
