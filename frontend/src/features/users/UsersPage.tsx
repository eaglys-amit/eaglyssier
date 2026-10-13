import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Plus, UserCog } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { BrandLink } from "@/components/layout/BrandLink";
import { PageHeader } from "@/components/layout/PageHeader";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { NoAccess } from "@/components/shared/NoAccess";
import { TableSkeleton } from "@/components/shared/TableSkeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UserMenu } from "@/features/auth/UserMenu";
import { api, ApiError } from "@/lib/api";
import { ROLE_LABELS, ROLES, useAccess, useMe } from "@/lib/permissions";
import { qk } from "@/lib/query-keys";
import type { Member, ProjectRole, UserAccount } from "@/types/api";

const NO_MEMBER = "__none__";

interface UserPatch {
  is_admin?: boolean;
  is_active?: boolean;
  member_id?: number;
  unlink_member?: boolean;
  password?: string;
}

function MemberSelect({
  members,
  users,
  value,
  onChange,
  selfId,
}: {
  members: Member[];
  users: UserAccount[];
  value: number | null;
  onChange: (memberId: number | null) => void;
  selfId?: number;
}) {
  // A member can back only one login.
  const taken = new Set(users.filter((u) => u.id !== selfId).map((u) => u.member_id));
  return (
    <Select
      value={value != null ? String(value) : NO_MEMBER}
      onValueChange={(v) => onChange(v === NO_MEMBER ? null : Number(v))}
    >
      <SelectTrigger className="h-8">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_MEMBER}>— Not linked —</SelectItem>
        {members.map((m) => (
          <SelectItem key={m.id} value={String(m.id)} disabled={taken.has(m.id)}>
            {m.display_name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function NewUserDialog({
  open,
  onOpenChange,
  members,
  users,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: Member[];
  users: UserAccount[];
}) {
  const qc = useQueryClient();
  const [memberId, setMemberId] = useState<number | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const create = useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      api.post<UserAccount>("/users", { ...body, is_admin: isAdmin, member_id: memberId }),
    onSuccess: (u) => {
      qc.invalidateQueries({ queryKey: qk.users });
      toast.success(`Created ${u.email}`);
      setMemberId(null);
      setIsAdmin(false);
      onOpenChange(false);
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not create user"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            create.mutate({
              email: String(fd.get("email") ?? "").trim(),
              password: String(fd.get("password") ?? ""),
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>New user</DialogTitle>
            <DialogDescription>
              Link the login to a member: their role on each project comes from that member's
              project memberships.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required autoComplete="off" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Initial password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                minLength={8}
                required
                autoComplete="new-password"
              />
            </div>
            <div className="grid gap-2">
              <Label>Member</Label>
              <MemberSelect members={members} users={users} value={memberId} onChange={setMemberId} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={isAdmin} onCheckedChange={(v) => setIsAdmin(v === true)} />
              Admin (users, integrations, provider, project create/delete)
            </label>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({
  user,
  onClose,
  onSave,
}: {
  user: UserAccount | null;
  onClose: () => void;
  onSave: (password: string) => void;
}) {
  return (
    <Dialog open={user !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave(String(new FormData(e.currentTarget).get("password") ?? ""));
          }}
        >
          <DialogHeader>
            <DialogTitle>Reset password for {user?.email}</DialogTitle>
            <DialogDescription>Their current sessions are signed out.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            <Label htmlFor="reset-password">New password</Label>
            <Input
              id="reset-password"
              name="password"
              type="password"
              minLength={8}
              required
              autoComplete="new-password"
            />
          </div>
          <DialogFooter>
            <Button type="submit">Reset password</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function UsersPage() {
  const qc = useQueryClient();
  const { isAdmin } = useAccess();
  const { data: me } = useMe();
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<UserAccount | null>(null);

  const { data: users, isPending } = useQuery({
    queryKey: qk.users,
    queryFn: () => api.get<UserAccount[]>("/users"),
    enabled: isAdmin,
  });
  const { data: members = [] } = useQuery({
    queryKey: qk.members,
    queryFn: () => api.get<Member[]>("/members"),
    enabled: isAdmin,
  });

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: UserPatch }) =>
      api.patch<UserAccount>(`/users/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.users });
      qc.invalidateQueries({ queryKey: qk.me });
      setResetting(null);
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not update user"),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/users/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.users });
      toast.success("User deleted");
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not delete user"),
  });
  const enroll = useMutation({
    mutationFn: ({ id, role }: { id: number; role: ProjectRole }) =>
      api.post<UserAccount>(`/users/${id}/memberships`, { role }),
    onSuccess: (_, { role }) => {
      // Memberships feed every project's member list.
      qc.invalidateQueries({ queryKey: qk.projects });
      toast.success(`Added to every project as ${ROLE_LABELS[role]}`);
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not add to projects"),
  });

  return (
    <>
      <PageHeader
        leading={<BrandLink />}
        title="Users"
        description="Logins and admin rights. Project roles are set per project under Members."
        actions={
          <>
            <UserMenu />
            <ThemeToggle />
          </>
        }
      />
      <div className="p-6">
        {!isAdmin ? (
          <NoAccess />
        ) : (
          <>
            <div className="mb-4 flex justify-end">
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="size-4" /> New user
              </Button>
            </div>
            {isPending ? (
              <TableSkeleton />
            ) : !users?.length ? (
              <EmptyState icon={UserCog} title="No users" />
            ) : (
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead className="w-56">Member</TableHead>
                        <TableHead className="w-20 text-center">Admin</TableHead>
                        <TableHead className="w-20 text-center">Active</TableHead>
                        <TableHead className="w-40">Last sign-in</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((u) => {
                        const isSelf = u.id === me?.id;
                        return (
                          <TableRow key={u.id}>
                            <TableCell className="font-medium">
                              {u.email}
                              {isSelf ? (
                                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                                  (you)
                                </span>
                              ) : null}
                            </TableCell>
                            <TableCell>
                              <MemberSelect
                                members={members}
                                users={users}
                                selfId={u.id}
                                value={u.member_id}
                                onChange={(memberId) =>
                                  patch.mutate({
                                    id: u.id,
                                    body:
                                      memberId == null
                                        ? { unlink_member: true }
                                        : { member_id: memberId },
                                  })
                                }
                              />
                            </TableCell>
                            <TableCell className="text-center">
                              <Switch
                                checked={u.is_admin}
                                disabled={isSelf}
                                onCheckedChange={(v) => patch.mutate({ id: u.id, body: { is_admin: v } })}
                                aria-label="Admin"
                              />
                            </TableCell>
                            <TableCell className="text-center">
                              <Switch
                                checked={u.is_active}
                                disabled={isSelf}
                                onCheckedChange={(v) => patch.mutate({ id: u.id, body: { is_active: v } })}
                                aria-label="Active"
                              />
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "Never"}
                            </TableCell>
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="size-8">
                                    <MoreHorizontal className="size-4" />
                                    <span className="sr-only">Actions</span>
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => setResetting(u)}>
                                    Reset password
                                  </DropdownMenuItem>
                                  <DropdownMenuSub>
                                    <DropdownMenuSubTrigger disabled={u.member_id == null}>
                                      Add to all projects as…
                                    </DropdownMenuSubTrigger>
                                    <DropdownMenuSubContent>
                                      {ROLES.map((r) => (
                                        <DropdownMenuItem
                                          key={r}
                                          onClick={() => enroll.mutate({ id: u.id, role: r })}
                                        >
                                          {ROLE_LABELS[r]}
                                        </DropdownMenuItem>
                                      ))}
                                    </DropdownMenuSubContent>
                                  </DropdownMenuSub>
                                  {!isSelf ? (
                                    <>
                                      <DropdownMenuSeparator />
                                      <ConfirmDialog
                                        trigger={
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="w-full justify-start px-2 text-destructive hover:text-destructive"
                                          >
                                            Delete user
                                          </Button>
                                        }
                                        title={`Delete ${u.email}?`}
                                        description="The login is removed. The linked member and their project data stay."
                                        onConfirm={() => remove.mutate(u.id)}
                                      />
                                    </>
                                  ) : null}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
            <NewUserDialog
              open={creating}
              onOpenChange={setCreating}
              members={members}
              users={users ?? []}
            />
            <ResetPasswordDialog
              user={resetting}
              onClose={() => setResetting(null)}
              onSave={(password) =>
                resetting &&
                patch.mutate(
                  { id: resetting.id, body: { password } },
                  { onSuccess: () => toast.success("Password reset") },
                )
              }
            />
          </>
        )}
      </div>
    </>
  );
}
