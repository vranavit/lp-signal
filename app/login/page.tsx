import { sendMagicLink } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Wordmark } from "@/components/brand/wordmark";

type SearchParams = Record<string, string | string[] | undefined>;

export default function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sent = searchParams.sent === "1";
  const email = typeof searchParams.email === "string" ? searchParams.email : "";
  const error = typeof searchParams.error === "string" ? searchParams.error : null;
  const next = typeof searchParams.next === "string" ? searchParams.next : "";

  return (
    <main className="min-h-screen flex items-center justify-center bg-bg px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Wordmark size="sm" />
        </div>

        <div className="card-surface p-6">
          <h1 className="text-[15px] font-semibold tracking-tightish text-ink">
            Sign in
          </h1>
          <p className="mt-1 text-[13px] text-ink-muted">
            Enter your email. We&rsquo;ll send a single-use link.
          </p>

          {sent ? (
            <div className="mt-5 border border-line rounded-sm px-3 py-3 text-[13px] bg-bg-panel">
              <div className="text-ink">
                Check{" "}
                <span className="num tabular-nums text-ink">{email}</span> for a
                sign-in link.
              </div>
              <div className="text-ink-muted mt-1">You can close this tab.</div>
            </div>
          ) : (
            <form action={sendMagicLink} className="mt-5 space-y-3">
              <Input
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@firm.com"
                defaultValue={email}
              />
              <input type="hidden" name="next" value={next} />
              <Button type="submit" className="w-full">
                Send magic link
              </Button>
            </form>
          )}

          {error ? (
            <div className="mt-4 border border-line rounded-sm px-3 py-2 text-[12px] text-ink-muted">
              {error === "invalid_email"
                ? "Enter a valid email address."
                : error}
            </div>
          ) : null}
        </div>

        <div className="mt-6 text-[11.5px] text-ink-faint">
          Access is restricted to allowlisted emails.
        </div>
      </div>
    </main>
  );
}
