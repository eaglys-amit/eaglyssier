import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { BrandLink } from "@/components/layout/BrandLink";
import { PageHeader } from "@/components/layout/PageHeader";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/TableSkeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, ApiError } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type { Member } from "@/types/api";

function MemberFormDialog({
  open,
  onOpenChange,
  member,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: Member | null; // null = create
}) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (body: { display_name: string; primary_email: string }) =>
      member
        ? api.patch<Member>(`/members/${member.id}`, { display_name: body.display_name })
        : api.post<Member>("/members", {
            display_name: body.display_name,
            primary_email: body.primary_email || null,
          }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.members });
      toast.success(member ? "Member renamed" : "Member added");
      onOpenChange(false);
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not save member"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            save.mutate({
              display_name: String(fd.get("display_name") ?? "").trim(),
              primary_email: String(fd.get("primary_email") ?? "").trim(),
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{member ? `Rename ${member.display_name}` : "New member"}</DialogTitle>
            <DialogDescription>
              {member
                ? "Update the display name shown across projects and reports."
                : "Members are curated by hand and mapped to discovered accounts per project."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="display_name">Display name</Label>
              <Input
                id="display_name"
                name="display_name"
                required
                defaultValue={member?.display_name ?? ""}
              />
            </div>
            {!member && (
              <div className="grid gap-2">
                <Label htmlFor="primary_email">Primary email (optional)</Label>
                <Input id="primary_email" name="primary_email" type="email" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : member ? "Rename" : "Add member"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MembersPage() {
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<{ open: boolean; member: Member | null }>({
    open: false,
    member: null,
  });
  const { data: members, isPending } = useQuery({
    queryKey: qk.members,
    queryFn: () => api.get<Member[]>("/members"),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/members/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.members });
      toast.success("Member deleted");
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not delete member"),
  });

  return (
    <>
      <PageHeader
        leading={<BrandLink />}
        title="Members"
        description="The curated people directory. Map accounts to members inside each project."
        actions={<ThemeToggle />}
      />
      <MemberFormDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        member={dialog.member}
      />
      <div className="p-6">
      {/* The empty state carries its own create button, so the toolbar steps
          aside for it. */}
      {isPending || members?.length ? (
        <div className="mb-4 flex justify-end">
          <Button size="sm" onClick={() => setDialog({ open: true, member: null })}>
            <Plus className="size-4" /> New member
          </Button>
        </div>
      ) : null}
      {isPending ? (
        <TableSkeleton />
      ) : !members?.length ? (
        <EmptyState
          icon={Users}
          title="No members yet"
          hint="Add the people on your team; sync never creates members automatically."
          action={
            <Button size="sm" onClick={() => setDialog({ open: true, member: null })}>
              <Plus className="size-4" /> New member
            </Button>
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.display_name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.primary_email || "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => setDialog({ open: true, member: m })}
                        >
                          <Pencil className="size-4" />
                          <span className="sr-only">Rename</span>
                        </Button>
                        <ConfirmDialog
                          trigger={
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-destructive hover:text-destructive"
                            >
                              <Trash2 className="size-4" />
                              <span className="sr-only">Delete</span>
                            </Button>
                          }
                          title={`Delete ${m.display_name}?`}
                          description="Their mapped accounts are unmapped (not deleted) and project memberships removed."
                          onConfirm={() => remove.mutate(m.id)}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      </div>
    </>
  );
}
