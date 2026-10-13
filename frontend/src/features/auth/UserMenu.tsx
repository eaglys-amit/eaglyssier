import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, LogOut, UserCog, UserRound } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
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
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { ROLE_LABELS, useAccess, useMe } from "@/lib/permissions";

function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const change = useMutation({
    mutationFn: (body: { current_password: string; new_password: string }) =>
      api.post("/auth/password", body),
    onSuccess: () => {
      toast.success("Password changed. Other devices were signed out.");
      onOpenChange(false);
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not change password"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            change.mutate({
              current_password: String(fd.get("current") ?? ""),
              new_password: String(fd.get("new") ?? ""),
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>At least 8 characters.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="current">Current password</Label>
              <Input id="current" name="current" type="password" autoComplete="current-password" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new">New password</Label>
              <Input id="new" name="new" type="password" autoComplete="new-password" minLength={8} required />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={change.isPending}>
              {change.isPending ? "Saving…" : "Change password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Who is signed in (and their role here, inside a project), plus account actions. */
export function UserMenu({ projectId }: { projectId?: number }) {
  const { data: me } = useMe();
  const { role, isAdmin } = useAccess(projectId);
  const qc = useQueryClient();
  const [passwordOpen, setPasswordOpen] = useState(false);

  const logout = useMutation({
    mutationFn: () => api.post("/auth/logout"),
    onSettled: () => {
      qc.clear();
      window.location.assign("/login");
    },
  });

  if (!me) return null;
  const roleLabel = role ? ROLE_LABELS[role] : isAdmin ? "Admin" : null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" title={me.display_name}>
            <UserRound className="size-4" />
            <span className="sr-only">Account</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <div className="truncate text-sm font-medium">{me.display_name}</div>
            <div className="truncate text-xs text-muted-foreground">{me.email}</div>
            {roleLabel ? (
              <div className="mt-1 text-xs text-muted-foreground">
                {projectId && role ? `${roleLabel} on this project` : roleLabel}
              </div>
            ) : null}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {isAdmin ? (
            <DropdownMenuItem asChild>
              <Link to="/users">
                <UserCog className="size-4" /> Users
              </Link>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => setPasswordOpen(true)}>
            <KeyRound className="size-4" /> Change password
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => logout.mutate()}>
            <LogOut className="size-4" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </>
  );
}
