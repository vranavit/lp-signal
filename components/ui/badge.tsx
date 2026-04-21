import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center border px-1.5 h-5 text-[10px] font-medium uppercase tracking-widest rounded-sm",
  {
    variants: {
      variant: {
        default: "border-line text-ink-muted bg-bg-panel",
        t1: "border-accent-hi text-accent-hi bg-bg-panel",
        t2: "border-line-strong text-ink bg-bg-panel",
        t3: "border-line text-ink-muted bg-bg-panel",
        seed: "border-line-strong text-ink-muted bg-bg",
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
