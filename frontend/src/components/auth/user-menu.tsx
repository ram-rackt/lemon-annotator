"use client";

import { Check, ChevronDown, Eye, EyeOff, KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { UserAvatar } from "@/components/user-avatar";
import { useAuth } from "@/hooks/use-auth";
import { pendingSave } from "@/lib/pending-save";
import { authErrorMessage, supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

/** Save edits that autosave hasn't written yet, then sign out. A failed save keeps the user signed in. */
async function signOut() {
  try {
    await pendingSave.flushAll();
  } catch {
    toast.error("Your latest changes couldn't be saved, so you're still signed in.", {
      description: "Fix the problem shown, or save again, then sign out.",
    });
    return;
  }
  const { error } = (await supabase()?.auth.signOut()) ?? {};
  if (error) toast.error("Couldn't sign out", { description: authErrorMessage(error) });
}

/** Account menu in the header (hosted setup only). */
export function UserMenu() {
  const { user, recovering, setRecovering } = useAuth();
  const [changing, setChanging] = useState(false);
  if (!user) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Account: ${user.name}`}
            className="group flex h-10 items-center gap-2 rounded-full border border-foreground/10 bg-background/60 py-1 pr-2.5 pl-1 shadow-sm transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=open]:bg-muted"
          >
            <UserAvatar name={user.name} seed={user.id} online className="size-8" />
            <span className="hidden max-w-32 truncate text-sm font-medium xl:inline">{user.name}</span>
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" sideOffset={10} className="w-72 overflow-hidden rounded-xl p-0 shadow-xl">
          <div className="relative flex items-center gap-3 px-4 py-4">
            <div
              aria-hidden
              className="absolute inset-0 -z-0 bg-gradient-to-br from-yellow-300/20 via-yellow-300/5 to-transparent"
            />
            <UserAvatar name={user.name} seed={user.id} online className="relative size-11 text-sm" />
            <div className="relative grid min-w-0 gap-0.5">
              <span className="truncate text-sm font-semibold">{user.name}</span>
              {user.email && <span className="truncate text-xs text-muted-foreground">{user.email}</span>}
              <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                <span className="size-1.5 rounded-full bg-emerald-500" /> Signed in
              </span>
            </div>
          </div>

          <DropdownMenuSeparator className="m-0" />
          <DropdownMenuGroup className="p-1.5">
            <DropdownMenuItem className="gap-3 rounded-lg px-2.5 py-2" onSelect={() => setChanging(true)}>
              <span className="grid size-8 place-items-center rounded-lg border bg-muted/50">
                <KeyRound />
              </span>
              <span className="grid">
                <span className="text-sm font-medium">Change password</span>
                <span className="text-xs text-muted-foreground">Update how you sign in</span>
              </span>
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator className="m-0" />
          <DropdownMenuGroup className="p-1.5">
            <DropdownMenuItem
              variant="destructive"
              className="gap-3 rounded-lg px-2.5 py-2"
              onSelect={() => void signOut()}
            >
              <span className="grid size-8 place-items-center rounded-lg border border-destructive/20 bg-destructive/5">
                <LogOut />
              </span>
              <span className="text-sm font-medium">Sign out</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <div className="flex items-center gap-1.5 border-t bg-muted/30 px-4 py-2.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="size-3.5 text-emerald-500" /> Your session is encrypted and private
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <ChangePasswordDialog
        open={changing || recovering}
        recovering={recovering}
        onOpenChange={(open) => {
          setChanging(open);
          if (!open) setRecovering(false);
        }}
      />
    </>
  );
}

/** 0–4: length, mixed case, digits, symbols. */
function strength(password: string): number {
  if (password.length < 8) return password ? 1 : 0;
  let score = 1;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;
  return Math.min(score, 4);
}

const STRENGTH = [
  { label: "", bar: "" },
  { label: "Too weak", bar: "bg-rose-500" },
  { label: "Okay", bar: "bg-amber-500" },
  { label: "Good", bar: "bg-lime-500" },
  { label: "Strong", bar: "bg-emerald-500" },
];

function ChangePasswordDialog({
  open,
  recovering,
  onOpenChange,
}: {
  open: boolean;
  recovering: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const score = strength(password);
  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && confirm !== password;
  const valid = password.length >= 8 && password === confirm;

  const close = () => {
    setPassword("");
    setConfirm("");
    setShow(false);
    setError(null);
    onOpenChange(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sb = supabase();
    if (!sb || !valid || pending) return;
    setPending(true);
    setError(null);
    try {
      const { error } = await sb.auth.updateUser({ password });
      if (error) {
        setError(authErrorMessage(error));
        return;
      }
      toast.success("Password updated", { description: "Use it the next time you sign in." });
      close();
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="rounded-2xl sm:max-w-md">
        <form className="grid gap-5" onSubmit={submit}>
          <DialogHeader className="gap-3">
            <span className="grid size-11 place-items-center rounded-xl bg-yellow-300 text-yellow-950 shadow-[0_8px_24px_-10px_rgb(250_204_21/0.8)]">
              <KeyRound className="size-5" />
            </span>
            <div className="grid gap-1">
              <DialogTitle className="text-lg">
                {recovering ? "Choose a new password" : "Change your password"}
              </DialogTitle>
              <DialogDescription>
                {recovering
                  ? "You opened a reset link. Pick a new password to finish."
                  : "Use at least 8 characters. Longer, with a mix of letters, numbers and symbols, is better."}
              </DialogDescription>
            </div>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="new-password">New password</Label>
            <div className="relative">
              <Input
                id="new-password"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-10 rounded-lg pr-10"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground"
                aria-label={show ? "Hide password" : "Show password"}
              >
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <div className="flex items-center gap-3">
              <div className="grid flex-1 grid-cols-4 gap-1">
                {[1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className={cn("h-1 rounded-full bg-muted transition-colors", i <= score && STRENGTH[score].bar)}
                  />
                ))}
              </div>
              <span className="w-16 text-right text-xs text-muted-foreground">{STRENGTH[score].label}</span>
            </div>
            {tooShort && <p className="text-xs text-destructive">Use at least 8 characters.</p>}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <div className="relative">
              <Input
                id="confirm-password"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                aria-invalid={mismatch}
                className="h-10 rounded-lg pr-10"
              />
              {valid && (
                <Check className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-emerald-500" />
              )}
            </div>
            {mismatch && <p className="text-xs text-destructive">The passwords don&apos;t match.</p>}
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={close} className="h-10 rounded-lg">
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!valid || pending}
              className="h-10 rounded-lg bg-yellow-300 font-semibold text-yellow-950 hover:bg-yellow-200 dark:bg-yellow-300 dark:hover:bg-yellow-200"
            >
              {pending && <Spinner />} Update password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
