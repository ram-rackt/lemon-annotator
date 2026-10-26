"use client";

import { createContext, useContext } from "react";

import { authEnabled } from "@/lib/supabase";

export interface SignedInUser {
  id: string;
  email: string | null;
  name: string;
}

export interface AuthState {
  user: SignedInUser | null;
  /** Data may be loaded: always without sign-in; with sign-in once a session is confirmed. */
  ready: boolean;
  /** Opened from a password-reset email: the user should choose a new password. */
  recovering: boolean;
  setRecovering: (value: boolean) => void;
}

export const AuthContext = createContext<AuthState>({
  user: null,
  ready: !authEnabled,
  recovering: false,
  setRecovering: () => {},
});

export const useAuth = () => useContext(AuthContext);

/** Queries wait for this, so nothing is requested before the sign-in is known. */
export const useSignedIn = () => useContext(AuthContext).ready;
