import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
  {
    variants: {
      variant: {
        default:
          "bg-accent text-black hover:bg-accent-hi border border-accent-hi",
        secondary:
          "bg-bg-panel text-ink border border-line hover:border-line-strong",
        ghost: "text-ink hover:bg-bg-panel",
        link: "text-accent underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-3 rounded-sm",
        sm: "h-8 px-2.5 rounded-sm text-xs",
        lg: "h-10 px-4 rounded-sm",
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
