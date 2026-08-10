import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderKanban, MoreHorizontal, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { BrandLink } from "@/components/layout/BrandLink";
import { PageHeader } from "@/components/layout/PageHeader";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/TableSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type { ProjectDetail, ProjectListItem } from "@/types/api";

function NewProjectDialog() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: (body: { name: string; key: string; description: string }) =>
      api.post<ProjectDetail>("/projects", {
        name: body.name,
        key: body.key || null,
        description: body.description || null,
      }),
    onSuccess: (project) => {
      qc.invalidateQueries({ queryKey: qk.projects });
      toast.success(`Project “${project.name}” created`);
      setOpen(false);
      navigate(`/projects/${project.id}`);
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not create project"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" /> New project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            create.mutate({
              name: String(fd.get("name") ?? "").trim(),
              key: String(fd.get("key") ?? "").trim(),
              description: String(fd.get("description") ?? "").trim(),
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              Create a project, then connect Jira/GitHub/GitLab under its Integrations section.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required placeholder="Payments Platform" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="key">Key (optional)</Label>
              <Input id="key" name="key" placeholder="PAY" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea id="description" name="description" rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectsPage() {
  const qc = useQueryClient();
  const { data: projects, isPending } = useQuery({
    queryKey: qk.projects,
    queryFn: () => api.get<ProjectListItem[]>("/projects"),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/projects/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.projects });
      toast.success("Project deleted");
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not delete project"),
  });

  return (
    <>
      <PageHeader
        leading={<BrandLink />}
        title="Projects"
        description="Agile project reports from Jira, GitHub, and GitLab data."
        actions={<ThemeToggle />}
      />
      <div className="p-6">
      {/* The empty state carries its own create button, so the toolbar steps
          aside for it. */}
      {isPending || projects?.length ? (
        <div className="mb-4 flex justify-end">
          <NewProjectDialog />
        </div>
      ) : null}
      {isPending ? (
        <TableSkeleton />
      ) : !projects?.length ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          hint="Create your first project to start syncing sprints, tasks, and repositories."
          action={<NewProjectDialog />}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Tasks</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Link
                        to={`/projects/${p.id}`}
                        className="font-medium text-foreground hover:text-primary hover:underline"
                      >
                        {p.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {p.key ? <Badge variant="secondary">{p.key}</Badge> : "—"}
                    </TableCell>
                    <TableCell className="max-w-md truncate text-muted-foreground">
                      {p.description || "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {p.task_count}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <ConfirmDialog
                            trigger={
                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-full justify-start px-2 text-destructive hover:text-destructive"
                              >
                                Delete project
                              </Button>
                            }
                            title={`Delete “${p.name}”?`}
                            description="This removes the project and all synced data (sprints, tasks, repos, reports). This cannot be undone."
                            onConfirm={() => remove.mutate(p.id)}
                          />
                        </DropdownMenuContent>
                      </DropdownMenu>
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
