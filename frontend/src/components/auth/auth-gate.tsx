"use client";

import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState } from "react";

import { LoginScreen } from "@/components/auth/login-screen";
import { Spinner } from "@/components/ui/spinner";
import { authEnabled, displayName, supabase } from "@/lib/supabase";

export interface SignedInUser {
  id: string;
  email: string | null;
  name: string;
}

interface AuthState {
  user: SignedInUser | null;
  /** Opened from a password-reset email: the user should choose a new password. */
  recovering: boolean;
  setRecovering: (value: boolean) => void;
}

const AuthContext = createContext<AuthState>({ user: null, recovering: false, setRecovering: () => {} });

export const useAuth = () => useContext(AuthContext);

/** Hosted setup: shows the sign-in screen until there is a session. Locally (no Supabase) it renders the app. */
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

  if (session === undefined) {
    return (
      <div className="grid min-h-svh place-items-center text-muted-foreground">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (!session) return <LoginScreen />;

  const user: SignedInUser = {
    id: session.user.id,
    email: session.user.email ?? null,
    name: displayName(session.user),
  };
  return <AuthContext.Provider value={{ user, recovering, setRecovering }}>{children}</AuthContext.Provider>;
}
