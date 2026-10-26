"use client";

import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { LoginScreen } from "@/components/auth/login-screen";
import { AuthContext, type AuthState } from "@/hooks/use-auth";
import { authEnabled, displayName, supabase } from "@/lib/supabase";

/**
 * Hosted setup: the sign-in screen when there is no session. Locally (no Supabase) it renders the app.
 *
 * While the saved session is still being read (and when the page is prerendered) the page itself is
 * rendered, showing its loading skeletons: queries wait for `ready`, so nothing is requested yet. This
 * keeps every route renderable for Next.js and avoids flashing the sign-in screen on reload.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  if (!authEnabled) return children;
  return <SignedIn>{children}</SignedIn>;
}

function SignedIn({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  // undefined: still reading the saved session (same on the server and the first client render).
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    const sb = supabase();
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      // Nothing from one account may be shown to the next one.
      if (event === "SIGNED_OUT") qc.clear();
    });
    return () => data.subscription.unsubscribe();
  }, [qc]);

  const value: AuthState = {
    user: session ? { id: session.user.id, email: session.user.email ?? null, name: displayName(session.user) } : null,
    ready: Boolean(session),
    recovering,
    setRecovering,
  };
  // Same element tree in every state, so the page isn't remounted once the session is confirmed.
  return <AuthContext.Provider value={value}>{session === null ? <LoginScreen /> : children}</AuthContext.Provider>;
}
