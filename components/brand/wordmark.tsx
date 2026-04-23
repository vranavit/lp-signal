import { cn } from "@/lib/utils";

/**
 * Pure-text Allocus wordmark. No icon, no mark, no graphic — the typography
 * is the brand. Inter @ 700 with tight tracking, inheriting color from the
 * parent so it works on white, on bg-subtle, and on dark surfaces without
 * prop changes.
 *
 * Sizes:
 *   sm  18px  — dashboard chrome, footer, login form
 *   md  24px  — landing-page nav
 *   lg  40px  — reserved for hero / full-bleed marketing contexts
 */

export type WordmarkSize = "sm" | "md" | "lg";

const SIZE_CLASS: Record<WordmarkSize, string> = {
  sm: "text-[18px] leading-none",
  md: "text-[24px] leading-none",
  lg: "text-[40px] leading-none",
};

export function Wordmark({
  size = "md",
  className,
  as: Tag = "span",
}: {
  size?: WordmarkSize;
  className?: string;
  as?: "span" | "div" | "h1";
}) {
  return (
    <Tag
      className={cn(
        "font-sans font-bold text-ink select-none",
        // Inter's `--font-inter` is wired in app/layout.tsx via next/font/google
        // and mapped to the default Tailwind sans stack, so font-sans picks it
        // up automatically. Tight tracking matches the Attio/Linear feel.
        SIZE_CLASS[size],
        className,
      )}
      style={{ letterSpacing: "-0.04em" }}
    >
      Allocus
    </Tag>
  );
}
