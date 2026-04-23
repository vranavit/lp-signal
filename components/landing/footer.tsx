import { Wordmark } from "@/components/brand/wordmark";

/**
 * Dark navy footer. Single non-neutral color on the page = a 3px muted-gold
 * top accent line (#D4A94A). That's the only "color" accent anywhere; it
 * functions as a signature border.
 */
export function Footer() {
  return (
    <footer
      className="relative"
      style={{ backgroundColor: "#0F1B3D", color: "#F5F5F4" }}
    >
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{ backgroundColor: "#D4A94A" }}
      />
      <div className="mx-auto max-w-[1200px] px-6 pt-14 pb-10">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-10">
          <div>
            <Wordmark size="lg" className="text-white" />
            <div
              className="mt-4 font-serif italic text-[17px] leading-snug max-w-[260px]"
              style={{ color: "rgba(245,245,244,0.85)" }}
            >
              LP intelligence for private markets.
            </div>
            <div
              className="mt-6 text-[11.5px]"
              style={{ color: "rgba(245,245,244,0.45)" }}
            >
              © {new Date().getFullYear()} Allocus · Closed beta
            </div>
          </div>
          <div>
            <div
              className="text-[10.5px] uppercase mb-4"
              style={{
                letterSpacing: "0.1em",
                color: "rgba(245,245,244,0.55)",
              }}
            >
              Product
            </div>
            <ul className="space-y-2.5 text-[13px]">
              <li>
                <FooterLink href="#proof">What it shows</FooterLink>
              </li>
              <li>
                <FooterLink href="#how">How it works</FooterLink>
              </li>
              <li>
                <FooterLink href="#faq">FAQ</FooterLink>
              </li>
              <li>
                <FooterLink href="#">Request demo</FooterLink>
              </li>
              <li>
                <FooterLink href="/login">Sign in</FooterLink>
              </li>
            </ul>
          </div>
          <div>
            <div
              className="text-[10.5px] uppercase mb-4"
              style={{
                letterSpacing: "0.1em",
                color: "rgba(245,245,244,0.55)",
              }}
            >
              Contact
            </div>
            <ul className="space-y-2.5 text-[13px]">
              <li>
                <a
                  href="mailto:vitek.vrana@bloorcapital.com?subject=Allocus%20demo"
                  className="transition-colors"
                  style={{ color: "rgba(245,245,244,0.85)" }}
                >
                  vitek.vrana@bloorcapital.com
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/vranavit/lp-signal"
                  target="_blank"
                  rel="noreferrer"
                  className="transition-colors"
                  style={{ color: "rgba(245,245,244,0.85)" }}
                >
                  GitHub
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className="transition-colors hover:text-white"
      style={{ color: "rgba(245,245,244,0.7)" }}
    >
      {children}
    </a>
  );
}
