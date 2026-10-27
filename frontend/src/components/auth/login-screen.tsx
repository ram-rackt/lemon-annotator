"use client";

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Play,
  ShieldCheck,
} from "lucide-react";
import { useRef, useState } from "react";

import { Logo } from "@/components/app-header";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { UserAvatar } from "@/components/user-avatar";
import { authErrorMessage, EMAIL_PATTERN, supabase } from "@/lib/supabase";

const fieldClass =
  "h-11 rounded-xl bg-muted/40 pl-10 shadow-none transition-colors focus-visible:border-yellow-400 focus-visible:ring-yellow-400/25 aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive/20 dark:bg-white/[0.03]";

type Mode = "signin" | "reset";
type FieldErrors = { email?: string; password?: string };

function validate(mode: Mode, email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!email) errors.email = "Enter your email address.";
  else if (!EMAIL_PATTERN.test(email)) errors.email = "Enter a valid email address, like name@company.com.";
  if (mode === "signin" && !password) errors.password = "Enter your password.";
  return errors;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="flex items-center gap-1.5 text-xs text-destructive">
      <AlertCircle className="size-3.5 shrink-0" /> {message}
    </p>
  );
}

export function LoginScreen() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const switchMode = (next: Mode) => {
    setMode(next);
    setFieldErrors({});
    setError(null);
    setNotice(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sb = supabase();
    if (!sb || pending) return;
    const address = email.trim();
    setError(null);
    setNotice(null);

    const errors = validate(mode, address, password);
    setFieldErrors(errors);
    if (errors.email) return emailRef.current?.focus();
    if (errors.password) return passwordRef.current?.focus();

    setPending(true);
    try {
      if (mode === "signin") {
        const { error } = await sb.auth.signInWithPassword({ email: address, password });
        if (error) {
          setError(authErrorMessage(error));
          // Most failures are a mistyped password: ready to retype it.
          requestAnimationFrame(() => passwordRef.current?.select());
        }
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(address, { redirectTo: window.location.origin });
        if (error) setError(authErrorMessage(error));
        else setNotice(`If ${address} has an account, a reset link is on its way. Check your inbox (and spam).`);
      }
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid min-h-svh bg-background lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <Showcase />

      <main className="relative flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between lg:justify-end">
          <Logo className="lg:hidden" />
          <ThemeToggle />
        </div>

        <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center py-12">
          <span className="mb-6 inline-flex w-fit items-center gap-1.5 rounded-full border bg-muted/50 px-3 py-1 text-xs font-medium text-muted-foreground">
            <Lock className="size-3" /> Private workspace
          </span>
          <h1 className="text-3xl font-semibold tracking-tight">
            {mode === "signin" ? "Sign in to Lemon" : "Reset your password"}
          </h1>
          <p className="mt-2 text-[15px] text-muted-foreground">
            {mode === "signin"
              ? "Welcome back. Pick up right where your team left off."
              : "Enter your account email and we'll send you a secure link to choose a new password."}
          </p>

          <form className="mt-8 grid gap-5" onSubmit={submit} noValidate>
            <div className="grid gap-2">
              <Label htmlFor="email" className="text-[13px]">
                Work email
              </Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={emailRef}
                  id="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoFocus
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (fieldErrors.email) setFieldErrors((f) => ({ ...f, email: undefined }));
                  }}
                  aria-invalid={Boolean(fieldErrors.email)}
                  aria-describedby={fieldErrors.email ? "email-error" : undefined}
                  className={fieldClass}
                />
              </div>
              <FieldError id="email-error" message={fieldErrors.email} />
            </div>

            {mode === "signin" && (
              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-[13px]">
                    Password
                  </Label>
                  <button
                    type="button"
                    onClick={() => switchMode("reset")}
                    className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Lock className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    ref={passwordRef}
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Your password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (fieldErrors.password) setFieldErrors((f) => ({ ...f, password: undefined }));
                    }}
                    onKeyDown={(e) => setCapsLock(e.getModifierState("CapsLock"))}
                    onKeyUp={(e) => setCapsLock(e.getModifierState("CapsLock"))}
                    onBlur={() => setCapsLock(false)}
                    aria-invalid={Boolean(fieldErrors.password)}
                    aria-describedby={fieldErrors.password ? "password-error" : undefined}
                    className={`${fieldClass} pr-11`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted-foreground transition-colors hover:text-foreground"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <FieldError id="password-error" message={fieldErrors.password} />
                {capsLock && !fieldErrors.password && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">Caps Lock is on.</p>
                )}
              </div>
            )}

            {error && (
              <Alert variant="destructive" role="alert" className="rounded-xl border-destructive/30 bg-destructive/5">
                <AlertCircle />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {notice && (
              <Alert
                role="status"
                className="rounded-xl border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
              >
                <CheckCircle2 />
                <AlertDescription className="text-inherit">{notice}</AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              disabled={pending}
              className="group h-11 w-full rounded-xl bg-yellow-300 text-[15px] font-semibold text-yellow-950 shadow-[0_10px_30px_-12px_rgb(250_204_21/0.75)] hover:bg-yellow-200 dark:bg-yellow-300 dark:hover:bg-yellow-200"
            >
              {pending ? <Spinner /> : null}
              {mode === "signin" ? "Sign in" : "Send reset link"}
              {!pending && <ArrowRight className="transition-transform group-hover:translate-x-0.5" />}
            </Button>

            {mode === "reset" && (
              <button
                type="button"
                onClick={() => switchMode("signin")}
                className="mx-auto flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="size-4" /> Back to sign in
              </button>
            )}
          </form>

          <div className="mt-10 space-y-3 border-t pt-6 text-center text-[13px] text-muted-foreground">
            <p>Need access? Ask your workspace owner to add you.</p>
            <p className="flex items-center justify-center gap-1.5 text-xs">
              <ShieldCheck className="size-3.5 text-emerald-500" /> Secured sign-in · encrypted session
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

/** Dark brand panel with a small, purely decorative preview of the workspace (wide screens only). */
function Showcase() {
  const markers = [
    { left: "12%", color: "bg-sky-400" },
    { left: "27%", color: "bg-yellow-300" },
    { left: "41%", color: "bg-emerald-400" },
    { left: "63%", color: "bg-rose-400" },
    { left: "78%", color: "bg-yellow-300" },
  ];
  const events = [
    { time: "00:03.120", name: "Smash", tag: "Forehand", color: "bg-sky-400" },
    { time: "00:07.840", name: "Drop", tag: "Winning shot", color: "bg-yellow-300" },
  ];

  return (
    <aside className="relative isolate hidden overflow-hidden bg-neutral-950 text-white lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-14">
      {/* Lemon glow + fine grid */}
      <div aria-hidden className="absolute inset-0 -z-10">
        <div className="absolute -top-40 -left-32 size-[34rem] rounded-full bg-yellow-400/25 blur-[120px]" />
        <div className="absolute top-1/3 -right-40 size-[28rem] rounded-full bg-amber-500/15 blur-[120px]" />
        <div className="absolute -bottom-48 left-1/4 size-[26rem] rounded-full bg-lime-400/10 blur-[120px]" />
        <div className="absolute inset-0 [background-image:linear-gradient(rgb(255_255_255/0.045)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.045)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_30%_40%,black,transparent_75%)]" />
      </div>

      <Logo className="text-white" />

      <div className="max-w-xl space-y-10">
        <div className="space-y-5">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/70 backdrop-blur">
            <span className="size-1.5 rounded-full bg-yellow-300 shadow-[0_0_10px_2px_rgb(253_224_71/0.6)]" />
            Video annotation workspace
          </span>
          <h2 className="text-4xl leading-[1.1] font-semibold tracking-tight text-balance xl:text-5xl">
            Label every frame.{" "}
            <span className="bg-gradient-to-r from-yellow-200 via-yellow-300 to-amber-400 bg-clip-text text-transparent">
              Ship cleaner data.
            </span>
          </h2>
          <p className="max-w-md text-[15px] leading-relaxed text-white/60">
            Stream videos straight from S3, tag moments with the keyboard, and work on the same project with your team,
            without ever overwriting each other.
          </p>
        </div>

        {/* Preview card */}
        <div
          aria-hidden
          className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-2xl shadow-black/40 backdrop-blur-xl"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-mono text-xs text-white/80">rally_014.mp4</span>
              <span className="rounded-md border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                In progress
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-white/50">
              <span className="flex -space-x-1.5">
                <UserAvatar name="Asha K" className="size-6 text-[9px] ring-2 ring-neutral-900" online />
                <UserAvatar name="Ravi S" className="size-6 text-[9px] ring-2 ring-neutral-900" online />
              </span>
              2 here
            </div>
          </div>

          <div className="relative grid aspect-[16/7] place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-neutral-800 via-neutral-900 to-black ring-1 ring-white/5">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_60%_40%,rgb(253_224_71/0.08),transparent_55%)]" />
            <span className="grid size-11 place-items-center rounded-full bg-white/10 ring-1 ring-white/20 backdrop-blur">
              <Play className="ml-0.5 size-4 fill-white text-white" />
            </span>
            <span className="absolute bottom-2 left-2.5 rounded bg-black/50 px-1.5 py-0.5 font-mono text-[10px] text-white/80">
              00:12.480 · F 374
            </span>
          </div>

          <div className="relative mt-3 h-4">
            <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/10">
              <div className="h-full w-[46%] rounded-full bg-white/60" />
            </div>
            {markers.map((m) => (
              <span
                key={m.left}
                className={`absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full ${m.color}`}
                style={{ left: m.left }}
              />
            ))}
            <span className="absolute top-1/2 left-[46%] size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow" />
          </div>

          <div className="mt-3 divide-y divide-white/5 rounded-xl border border-white/5 bg-black/20">
            {events.map((e) => (
              <div key={e.time} className="flex items-center gap-3 px-3 py-2 text-xs">
                <span className="font-mono text-white/50">{e.time}</span>
                <span className={`size-1.5 rounded-full ${e.color}`} />
                <span className="font-medium text-white/90">{e.name}</span>
                <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-white/60">{e.tag}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-white/45">
        <span>Streams from your S3 bucket</span>
        <span>Autosaves every change</span>
        <span>One-click JSON export</span>
      </div>
    </aside>
  );
}
