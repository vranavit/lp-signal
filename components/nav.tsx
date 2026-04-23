import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";

type NavItem = { href: string; label: string; shortcut?: string };

const items: NavItem[] = [
  { href: "/signals", label: "Signals", shortcut: "S" },
  { href: "/plans", label: "Plans", shortcut: "P" },
  { href: "/settings", label: "Settings", shortcut: "," },
];

export function TopNav({
  active,
  userEmail,
}: {
  active: string;
  userEmail: string | null;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur supports-[backdrop-filter]:bg-bg/70">
      <div className="max-w-[1440px] mx-auto flex items-center justify-between h-11 px-5">
        <div className="flex items-center gap-7">
          <Link
            href="/signals"
            className="flex items-center gap-2 group cursor-pointer"
            aria-label="Allocus"
          >
            <Wordmark size="sm" />
          </Link>
          <nav className="flex items-center gap-0.5">
            {items.map((i) => {
              const isActive = active === i.href;
              return (
                <Link
                  key={i.href}
                  href={i.href}
                  className={
                    "h-7 px-2.5 inline-flex items-center gap-2 text-[12px] rounded-sm transition-colors duration-150 cursor-pointer " +
                    (isActive
                      ? "text-ink bg-bg-panel border border-line"
                      : "text-ink-muted hover:text-ink hover:bg-bg-subtle border border-transparent")
                  }
                >
                  <span>{i.label}</span>
                  {i.shortcut ? (
                    <span className="kbd hidden sm:inline-flex">{i.shortcut}</span>
                  ) : null}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/70 shadow-[0_0_6px_rgba(16,185,129,0.6)]" />
            <span className="mono text-[10px] uppercase tracking-widestish text-ink-faint">
              Live
            </span>
          </div>
          {userEmail ? (
            <span className="mono text-[11px] text-ink-muted hidden sm:inline">
              {userEmail}
            </span>
          ) : null}
          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
              className="h-7 px-2.5 inline-flex items-center text-[12px] text-ink-muted hover:text-ink border border-line hover:border-line-strong rounded-sm transition-colors duration-150 cursor-pointer"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
