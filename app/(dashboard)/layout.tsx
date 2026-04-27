import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: userProfile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const adminEmails = new Set(["vitek.vrana@bloorcapital.com"]);
  const isAdmin =
    adminEmails.has((user.email ?? "").toLowerCase()) ||
    userProfile?.role === "admin";

  // Sidebar reads the active route via usePathname() in a client component.
  // Earlier this layout tried to read x-invoke-path / next-url HTTP headers
  // and fall back to "/signals" when neither was set; both headers are
  // unreliable in app-router server layouts (no middleware sets next-url, and
  // x-invoke-path is internal Next.js plumbing) so the cascade fell through
  // to "/signals" on every request, hard-pinning the active state. Moved the
  // logic into the client.

  return (
    <div className="min-h-screen bg-bg text-ink">
      <Sidebar userEmail={user.email ?? null} isAdmin={isAdmin} />
      <main className="pl-[200px]">
        <div className="px-6 py-6">{children}</div>
      </main>
    </div>
  );
}
