"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { z } from "zod";

const Schema = z.object({
  email: z.string().email().transform((s) => s.trim().toLowerCase()),
  next: z.string().optional(),
});

export async function sendMagicLink(formData: FormData) {
  const parsed = Schema.safeParse({
    email: formData.get("email"),
    next: formData.get("next"),
  });

  if (!parsed.success) {
    redirect("/login?error=invalid_email");
  }

  const { email, next } = parsed.data;
  const supabase = createSupabaseServerClient();

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const redirectTo = new URL("/auth/callback", siteUrl);
  if (next) redirectTo.searchParams.set("next", next);

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectTo.toString(),
      // We still let Supabase create a user row on first sign-in; the
      // allowlist trigger rejects the insert if the email is not whitelisted.
      shouldCreateUser: true,
    },
  });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  redirect(`/login?sent=1&email=${encodeURIComponent(email)}`);
}
