import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-[13px] font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg cursor-pointer",
  {
    variants: {
      variant: {
        default:
          "bg-ink text-bg hover:bg-ink/90 border border-ink",
        accent:
          "bg-accent text-bg hover:bg-accent-hi border border-accent-hi",
        secondary:
          "bg-bg-panel text-ink border border-line hover:border-line-strong hover:bg-bg-hover",
        outline:
          "bg-transparent text-ink-muted border border-line hover:text-ink hover:border-line-strong",
        ghost:
          "text-ink-muted hover:text-ink hover:bg-bg-subtle border border-transparent",
        link:
          "text-accent-hi underline-offset-4 hover:underline border border-transparent px-1",
        danger:
          "bg-red-600 text-white hover:bg-red-500 border border-red-500",
      },
      size: {
        default: "h-8 px-3 rounded-sm",
        sm: "h-7 px-2.5 rounded-sm text-[12px]",
        lg: "h-9 px-4 rounded-sm",
        icon: "h-8 w-8 rounded-sm",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export { buttonVariants };
