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

/** Same rule as the backend: profile name, else the part of the email before the @. */
export function displayName(user: User): string {
  const meta = user.user_metadata ?? {};
  return String(meta.full_name || meta.name || user.email?.split("@")[0] || "You");
}
