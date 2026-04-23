import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";

export function TopNav({ authenticated }: { authenticated: boolean }) {
  return (
    <header className="w-full border-b border-neutral-200 bg-white/85 backdrop-blur-sm sticky top-0 z-20">
      <div className="mx-auto max-w-[1200px] px-6 h-16 flex items-center justify-between">
        <Wordmark size="md" />
        <div className="flex items-center gap-7">
          <a
            href="#how"
            className="hidden sm:inline text-[13px] text-neutral-700 hover:text-navy transition-colors"
          >
            How it works
          </a>
          <a
            href="#faq"
            className="hidden sm:inline text-[13px] text-neutral-700 hover:text-navy transition-colors"
          >
            FAQ
          </a>
          {authenticated ? (
            <Link
              href="/signals"
              className="text-[13px] text-neutral-700 hover:text-navy transition-colors"
            >
              Go to dashboard →
            </Link>
          ) : (
            <Link
              href="/login"
              className="text-[13px] text-neutral-700 hover:text-navy transition-colors"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
