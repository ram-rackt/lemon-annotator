import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

// Hosted setup only. Locally (no Supabase variables) Lemon has no sign-in and serves this machine only.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
// Supabase calls this the publishable key (newer projects) or the anon key (older ones); either works.
const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export const authEnabled = Boolean(SUPABASE_URL && SUPABASE_KEY);

let client: SupabaseClient | null = null;

/** The browser's Supabase client, or null when sign-in is off (or on the server). */
export function supabase(): SupabaseClient | null {
  if (!authEnabled || typeof window === "undefined") return null;
  client ??= createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

/** Current access token for API requests (refreshed by Supabase when it is about to expire). */
export async function accessToken(): Promise<string | null> {
  const sb = supabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? null;
}

/** Loose check for "looks like an email"; Supabase does the real validation. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** A Supabase Auth error (or a thrown fetch error) in plain language. */
export function authErrorMessage(error: { message?: string; code?: string } | unknown): string {
  const { message = "", code = "" } = (error ?? {}) as { message?: string; code?: string };
  if (code === "invalid_credentials" || /invalid login credentials/i.test(message))
    return "Incorrect email or password. Check both and try again.";
  if (code === "email_not_confirmed" || /email not confirmed/i.test(message))
    return "This email isn't confirmed yet. Use the link in your inbox, or ask the workspace owner to confirm it.";
  if (code === "user_banned" || /banned/i.test(message))
    return "This account has been disabled. Contact the workspace owner.";
  if (/rate.?limit|too many/i.test(code + " " + message)) return "Too many attempts. Wait a minute, then try again.";
  if (code === "same_password" || /different from the old password/i.test(message))
    return "The new password must be different from your current one.";
  if (code === "weak_password") return message || "That password is too weak. Choose a longer one.";
  if (code === "session_not_found" || code === "session_expired" || /session/i.test(code))
    return "Your session has expired. Sign in again, then retry.";
  if (/failed to fetch|fetch|network|load failed/i.test(message))
    return "Can't reach the sign-in service. Check your internet connection and try again.";
  return message || "Something went wrong. Please try again.";
}

/** Same rule as the backend: profile name, else the part of the email before the @. */
export function displayName(user: User): string {
  const meta = user.user_metadata ?? {};
  return String(meta.full_name || meta.name || user.email?.split("@")[0] || "You");
}
