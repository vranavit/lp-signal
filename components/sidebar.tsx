import Link from "next/link";
import {
  Activity,
  Building2,
  Search,
  Send,
  Settings as SettingsIcon,
} from "lucide-react";
import { Wordmark } from "@/components/brand/wordmark";

type NavItem = {
  href: string;
  label: string;
  Icon: typeof Activity;
};

const baseItems: NavItem[] = [
  { href: "/signals", label: "Signals", Icon: Activity },
  { href: "/explore", label: "Explore", Icon: Search },
  { href: "/plans", label: "Plans", Icon: Building2 },
  { href: "/settings", label: "Settings", Icon: SettingsIcon },
];

const adminItems: NavItem[] = [
  { href: "/outreach", label: "Outreach", Icon: Send },
];

export function Sidebar({
  active,
  userEmail,
  isAdmin,
}: {
  active: string;
  userEmail: string | null;
  isAdmin?: boolean;
}) {
  const items = isAdmin ? [...baseItems, ...adminItems] : baseItems;
  return (
    <aside className="fixed top-0 left-0 bottom-0 w-[200px] border-r border-line bg-bg-subtle flex flex-col z-30">
      {/* Wordmark */}
      <div className="h-14 px-4 flex items-center border-b border-line">
        <Link href="/" aria-label="Allocus home">
          <Wordmark size="sm" />
        </Link>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-2 py-3 flex flex-col gap-0.5">
        {items.map(({ href, label, Icon }) => {
          const isActive = active === href;
          return (
            <Link
              key={href}
              href={href}
              className={
                "flex items-center gap-2.5 h-8 px-2 rounded-sm text-[13px] transition-colors duration-150 cursor-pointer " +
                (isActive
                  ? "bg-bg-panel text-ink"
                  : "text-ink-muted hover:text-ink hover:bg-bg-panel/60")
              }
            >
              <Icon
                className={
                  "h-[15px] w-[15px] " +
                  (isActive ? "text-accent" : "text-ink-faint")
                }
                strokeWidth={1.75}
              />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer: live + user + sign out */}
      <div className="border-t border-line p-3 flex flex-col gap-2.5">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_4px_rgba(30,64,175,0.5)]" />
          <span className="text-[11px] text-ink-muted">Live</span>
        </div>
        {userEmail ? (
          <div
            className="text-[11px] text-ink-muted truncate"
            title={userEmail}
          >
            {userEmail}
          </div>
        ) : null}
        <form action="/auth/sign-out" method="post">
          <button
            type="submit"
            className="h-7 w-full px-2 inline-flex items-center justify-center text-[12px] text-ink-muted hover:text-ink border border-line hover:border-line-strong rounded-sm transition-colors duration-150 cursor-pointer"
          >
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
