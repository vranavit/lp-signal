import { headers } from "next/headers";
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

  const h = headers();
  const pathname = h.get("x-invoke-path") ?? h.get("next-url") ?? "/signals";
  const active =
    pathname.startsWith("/plans")
      ? "/plans"
      : pathname.startsWith("/settings")
      ? "/settings"
      : pathname.startsWith("/outreach")
      ? "/outreach"
      : "/signals";

  return (
    <div className="min-h-screen bg-bg text-ink">
      <Sidebar
        active={active}
        userEmail={user.email ?? null}
        isAdmin={isAdmin}
      />
      <main className="pl-[200px]">
        <div className="px-6 py-6">{children}</div>
      </main>
    </div>
  );
}
