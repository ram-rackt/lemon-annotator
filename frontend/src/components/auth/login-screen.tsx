"use client";

import { useState } from "react";

import { Logo } from "@/components/app-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { supabase } from "@/lib/supabase";

function friendly(message: string): string {
  if (/invalid login credentials/i.test(message)) return "Wrong email or password.";
  if (/email not confirmed/i.test(message))
    return "This email isn't confirmed yet. Use the link in your inbox, or ask the owner to confirm it.";
  if (/fetch|network/i.test(message)) return "Can't reach the sign-in service. Check your connection and try again.";
  return message;
}

export function LoginScreen() {
  const [mode, setMode] = useState<"signin" | "reset">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sb = supabase();
    if (!sb) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "signin") {
        const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
        if (error) setError(friendly(error.message));
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
        if (error) setError(friendly(error.message));
        else setNotice("If that address has an account, a link to set a new password is on its way.");
      }
    } catch (err) {
      setError(friendly(err instanceof Error ? err.message : String(err)));
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="grid min-h-svh place-items-center bg-muted/30 px-4">
      <div className="w-full max-w-sm space-y-6">
        <Logo className="justify-center" />
        <Card>
          <CardHeader>
            <CardTitle>{mode === "signin" ? "Sign in" : "Reset password"}</CardTitle>
            <CardDescription>
              {mode === "signin"
                ? "Use the account the workspace owner created for you."
                : "We'll email you a link to choose a new password."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4" onSubmit={submit}>
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              {mode === "signin" && (
                <div className="grid gap-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              )}
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {notice && (
                <Alert>
                  <AlertDescription>{notice}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" disabled={pending} className="w-full">
                {pending && <Spinner />} {mode === "signin" ? "Sign in" : "Send reset link"}
              </Button>
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => {
                  setMode(mode === "signin" ? "reset" : "signin");
                  setError(null);
                  setNotice(null);
                }}
              >
                {mode === "signin" ? "Forgot your password?" : "Back to sign in"}
              </button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
