import Link from "next/link";

type NavItem = { href: string; label: string };

const items: NavItem[] = [
  { href: "/signals", label: "Signals" },
  { href: "/plans", label: "Plans" },
  { href: "/settings", label: "Settings" },
];

export function TopNav({
  active,
  userEmail,
}: {
  active: string;
  userEmail: string | null;
}) {
  return (
    <header className="border-b border-line bg-bg">
      <div className="max-w-[1400px] mx-auto flex items-center justify-between h-12 px-6">
        <div className="flex items-center gap-8">
          <Link href="/signals" className="flex items-baseline gap-1.5">
            <span className="text-[11px] uppercase tracking-widest mono text-ink-faint">LP</span>
            <span className="text-sm font-semibold tracking-tightish text-ink">Signal</span>
          </Link>
          <nav className="flex items-center gap-1">
            {items.map((i) => {
              const isActive = active === i.href;
              return (
                <Link
                  key={i.href}
                  href={i.href}
                  className={
                    "h-8 px-2.5 inline-flex items-center text-xs rounded-sm " +
                    (isActive
                      ? "text-ink bg-bg-panel border border-line"
                      : "text-ink-muted hover:text-ink hover:bg-bg-panel border border-transparent")
                  }
                >
                  {i.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {userEmail ? (
            <span className="mono text-[11px] text-ink-muted">{userEmail}</span>
          ) : null}
          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
              className="h-8 px-2.5 inline-flex items-center text-xs text-ink-muted hover:text-ink border border-line hover:border-line-strong rounded-sm"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
