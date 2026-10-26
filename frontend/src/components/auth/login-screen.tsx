"use client";

import { ArrowLeft, Eye, EyeOff, Lock, Mail, MonitorPlay, ShieldCheck, Users } from "lucide-react";
import { useState } from "react";

import { Logo } from "@/components/app-header";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { supabase } from "@/lib/supabase";

function friendly(message: string): string {
  if (/invalid login credentials/i.test(message)) return "Wrong email or password.";
  if (/email not confirmed/i.test(message))
    return "This email isn't confirmed yet. Use the link in your inbox, or ask the workspace owner to confirm it.";
  if (/rate limit|too many/i.test(message)) return "Too many attempts. Wait a minute, then try again.";
  if (/fetch|network/i.test(message)) return "Can't reach the sign-in service. Check your connection and try again.";
  return message;
}

const FEATURES = [
  { icon: MonitorPlay, title: "Frame-accurate player", text: "Stream straight from S3 and label with the keyboard." },
  { icon: Users, title: "Built for teams", text: "Live progress, and see who is on which video." },
  { icon: ShieldCheck, title: "Nothing gets lost", text: "Autosave, and no one overwrites anyone else's work." },
];

export function LoginScreen() {
  const [mode, setMode] = useState<"signin" | "reset">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const switchMode = (next: "signin" | "reset") => {
    setMode(next);
    setError(null);
    setNotice(null);
  };

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
        else setNotice("If that address has an account, a link to choose a new password is on its way.");
      }
    } catch (err) {
      setError(friendly(err instanceof Error ? err.message : String(err)));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid min-h-svh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Brand panel (wide screens) */}
      <aside className="relative hidden overflow-hidden border-r bg-muted/40 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgb(253_224_71/0.35),transparent_45%),radial-gradient(circle_at_85%_90%,rgb(251_191_36/0.18),transparent_40%)] dark:bg-[radial-gradient(circle_at_20%_15%,rgb(253_224_71/0.14),transparent_45%),radial-gradient(circle_at_85%_90%,rgb(251_191_36/0.08),transparent_40%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 [background-image:radial-gradient(rgb(0_0_0/0.07)_1px,transparent_1px)] [background-size:22px_22px] dark:[background-image:radial-gradient(rgb(255_255_255/0.06)_1px,transparent_1px)]"
        />
        <Logo className="relative" />
        <div className="relative max-w-md space-y-8">
          <div className="space-y-3">
            <h2 className="text-3xl leading-tight font-semibold tracking-tight text-balance">
              Annotate videos together, frame by frame.
            </h2>
            <p className="text-muted-foreground">
              Label every moment of your S3 videos and export clean JSON when you&apos;re done.
            </p>
          </div>
          <ul className="space-y-5">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-background/80 text-foreground shadow-sm ring-1 ring-border">
                  <Icon className="size-[18px]" />
                </span>
                <span className="space-y-0.5">
                  <span className="block text-sm font-medium">{title}</span>
                  <span className="block text-sm text-muted-foreground">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-muted-foreground">Private workspace · accounts are created by the owner</p>
      </aside>

      {/* Form */}
      <main className="relative flex flex-col px-4 py-6 sm:px-8">
        <div className="flex items-center justify-between lg:justify-end">
          <Logo className="lg:hidden" />
          <ThemeToggle />
        </div>

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <div className="mb-8 space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {mode === "signin" ? "Welcome back" : "Reset your password"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {mode === "signin"
                ? "Sign in to your Lemon workspace."
                : "Enter your email and we'll send you a link to choose a new password."}
            </p>
          </div>

          <form className="grid gap-5" onSubmit={submit}>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  required
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-10 pl-9"
                />
              </div>
            </div>

            {mode === "signin" && (
              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <button
                    type="button"
                    onClick={() => switchMode("reset")}
                    className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Lock className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-10 pr-10 pl-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>
            )}

            {error && (
              <Alert variant="destructive" className="border-destructive/30 bg-destructive/5">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {notice && (
              <Alert className="border-emerald-500/30 bg-emerald-500/5">
                <AlertDescription>{notice}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" disabled={pending} className="h-10 w-full text-[15px]">
              {pending && <Spinner />}
              {mode === "signin" ? "Sign in" : "Send reset link"}
            </Button>

            {mode === "reset" && (
              <button
                type="button"
                onClick={() => switchMode("signin")}
                className="mx-auto flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="size-4" /> Back to sign in
              </button>
            )}
          </form>

          <p className="mt-10 text-center text-xs text-muted-foreground">
            No account? Ask the workspace owner to add you.
          </p>
        </div>
      </main>
    </div>
  );
}
