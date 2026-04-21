import { sendMagicLink } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
        <div className="mb-10">
          <div className="text-[11px] uppercase tracking-widest text-ink-faint mono">
            LP / Signal
          </div>
          <h1 className="mt-2 text-lg font-semibold tracking-tightish text-ink">
            Sign in
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Enter your email. We&rsquo;ll send a single-use link.
          </p>
        </div>

        {sent ? (
          <div className="panel px-4 py-4 text-sm">
            <div className="text-ink">Check <span className="mono">{email}</span> for a sign-in link.</div>
            <div className="text-ink-muted mt-1">You can close this tab.</div>
          </div>
        ) : (
          <form action={sendMagicLink} className="space-y-3">
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
          <div className="mt-4 border border-line px-3 py-2 text-xs text-ink-muted">
            {error === "invalid_email" ? "Enter a valid email address." : error}
          </div>
        ) : null}

        <div className="mt-10 text-[11px] uppercase tracking-widest text-ink-faint mono">
          Access is restricted to allowlisted emails.
        </div>
      </div>
    </main>
  );
}
