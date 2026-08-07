import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Users, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { PlatformIcon } from "@/components/shared/PlatformIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import type { Identity, ProjectMembers } from "@/types/api";

import { SyncMembersDialog } from "./members/SyncMembersDialog";

const UNMAPPED = "__none__";

export function ProjectMembersTab({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const [pick, setPick] = useState("");
  const { data } = useQuery({
    queryKey: qk.projectMembers(projectId),
    queryFn: () => api.get<ProjectMembers>(`/projects/${projectId}/members`),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.projectMembers(projectId) });
    qc.invalidateQueries({ queryKey: qk.kpi(projectId) });
  };
  const add = useMutation({
    mutationFn: (memberId: number) =>
      api.post(`/projects/${projectId}/members`, { member_id: memberId }),
    onSuccess: () => {
      invalidate();
      setPick("");
      toast.success("Member added to project");
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not add member"),
  });
  const remove = useMutation({
    mutationFn: (memberId: number) => api.delete(`/projects/${projectId}/members/${memberId}`),
    onSuccess: () => {
      invalidate();
      toast.success("Member removed from project");
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not remove member"),
  });
  const map = useMutation({
    mutationFn: ({ identityId, memberId }: { identityId: number; memberId: number | null }) =>
      api.put<Identity>(`/projects/${projectId}/identities/${identityId}/mapping`, {
        member_id: memberId,
      }),
    onSuccess: () => invalidate(),
    onError: (err: ApiError) => toast.error(err.detail || "Could not update mapping"),
  });

  if (!data) return null;

  // member_id -> mapped account labels, for the members table.
  const accountsByMember = new Map<number, string[]>();
  for (const platform of data.identities) {
    for (const acc of platform.accounts) {
      if (acc.member_id != null) {
        const label = `${platform.label}: ${acc.display_name || acc.username || acc.email || acc.external_id}`;
        accountsByMember.set(acc.member_id, [
          ...(accountsByMember.get(acc.member_id) ?? []),
          label,
        ]);
      }
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Project members</CardTitle>
          <CardDescription>
            Curated people on this project. Manage the global directory on the{" "}
            <Link to="/members" className="text-primary hover:underline">
              Members page
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Select value={pick} onValueChange={setPick}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Add a member…" />
              </SelectTrigger>
              <SelectContent>
                {data.available.length ? (
                  data.available.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      {m.display_name}
                    </SelectItem>
                  ))
                ) : (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    Everyone is already on this project.
                  </div>
                )}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              disabled={!pick || add.isPending}
              onClick={() => add.mutate(Number(pick))}
            >
              <UserPlus className="size-4" /> Add
            </Button>
          </div>

          {!data.members.length ? (
            <EmptyState
              icon={Users}
              title="No members on this project"
              hint="Add members above, then map their discovered accounts below."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Mapped accounts</TableHead>
                  <TableHead className="w-20 text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.display_name}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(accountsByMember.get(m.id) ?? []).map((label) => (
                          <Badge key={label} variant="secondary" className="text-xs">
                            {label}
                          </Badge>
                        ))}
                        {!accountsByMember.get(m.id)?.length ? (
                          <span className="text-xs text-muted-foreground">No accounts mapped</span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <ConfirmDialog
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-muted-foreground hover:text-destructive"
                          >
                            <X className="size-4" />
                            <span className="sr-only">Remove from project</span>
                          </Button>
                        }
                        title={`Remove ${m.display_name} from this project?`}
                        description="Their mapped accounts in this project are unmapped."
                        confirmLabel="Remove"
                        onConfirm={() => remove.mutate(m.id)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <section>
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="mb-1 text-sm font-semibold tracking-tight">Discovered accounts</h2>
            <p className="text-xs text-muted-foreground">
              External accounts found while syncing. Map each to a project member to attribute
              their tasks, commits, and reviews — or match them all at once.
            </p>
          </div>
          {data.identities.length ? <SyncMembersDialog projectId={projectId} /> : null}
        </div>
        {!data.identities.length ? (
          <EmptyState
            icon={Users}
            title="Nothing discovered yet"
            hint="Run a sync on the Data tab; assignees and commit authors show up here."
          />
        ) : (
          <div className="space-y-4">
            {data.identities.map((platform) => (
              <Card key={platform.platform}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <PlatformIcon platform={platform.platform} />
                    {platform.label}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Account</TableHead>
                        <TableHead className="w-64">Email</TableHead>
                        <TableHead className="w-56">Mapped to</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {platform.accounts.map((acc) => (
                        <TableRow key={acc.id}>
                          <TableCell>
                            <span className="font-medium">
                              {acc.display_name || acc.username || acc.external_id}
                            </span>
                            {acc.username && acc.display_name ? (
                              <span className="ml-1.5 text-xs text-muted-foreground">
                                @{acc.username}
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell className="truncate text-muted-foreground">
                            {acc.email || "—"}
                          </TableCell>
                          <TableCell>
                            <Select
                              value={acc.member_id != null ? String(acc.member_id) : UNMAPPED}
                              onValueChange={(v) =>
                                map.mutate({
                                  identityId: acc.id,
                                  memberId: v === UNMAPPED ? null : Number(v),
                                })
                              }
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={UNMAPPED}>— Unmapped —</SelectItem>
                                {data.members.map((m) => (
                                  <SelectItem key={m.id} value={String(m.id)}>
                                    {m.display_name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
