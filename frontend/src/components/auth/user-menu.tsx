"use client";

import { KeyRound, LogOut } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth/auth-gate";
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
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { initials } from "@/lib/format";
import { supabase } from "@/lib/supabase";

/** Account menu in the header (hosted setup only). */
export function UserMenu() {
  const { user, recovering, setRecovering } = useAuth();
  const [changing, setChanging] = useState(false);
  if (!user) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="size-10 rounded-lg p-0" aria-label="Account">
            <span className="grid size-8 place-items-center rounded-full bg-sky-500 text-xs font-semibold text-white">
              {initials(user.name)}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="grid font-normal">
            <span className="truncate font-medium">{user.name}</span>
            {user.email && <span className="truncate text-xs text-muted-foreground">{user.email}</span>}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setChanging(true)}>
            <KeyRound /> Change password
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void supabase()?.auth.signOut()}>
            <LogOut /> Sign out
          </DropdownMenuItem>
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
  const [pending, setPending] = useState(false);
  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && confirm !== password;
  const valid = password.length >= 8 && password === confirm;

  const close = () => {
    setPassword("");
    setConfirm("");
    onOpenChange(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sb = supabase();
    if (!sb || !valid) return;
    setPending(true);
    const { error } = await sb.auth.updateUser({ password });
    setPending(false);
    if (error) {
      toast.error("Couldn't change the password", { description: error.message });
      return;
    }
    toast.success("Password changed");
    close();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-sm">
        <form className="grid gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{recovering ? "Choose a new password" : "Change password"}</DialogTitle>
            <DialogDescription>At least 8 characters.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={tooShort}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="confirm-password">Repeat it</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              aria-invalid={mismatch}
            />
            {mismatch && <p className="text-xs text-destructive">The passwords don&apos;t match.</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || pending}>
              {pending && <Spinner />} Save password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
