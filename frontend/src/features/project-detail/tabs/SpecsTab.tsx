import { ArrowLeft, FileCheck2, Loader2, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { StatusBadge } from "@/components/shared/StatusBadge";
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
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { formatDateTime } from "@/lib/format";
import { useAccess } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { Requirement, SpecDetail, SpecSummary } from "@/types/api";

import { TabShell } from "@/features/project-detail/TabShell";
import { useReferenceFiles } from "@/features/project-detail/tabs/documents/useReferenceFiles";
import { RequirementDialog, RequirementForm } from "./specs/RequirementDialog";
import { changeBadge, CoverageBars, requirementStatusBadge } from "./specs/spec-ui";
import { useSpec, useSpecList, useSpecMutations } from "./specs/useSpecs";

function NewSpecDialog({ projectId, open, onOpenChange, onCreated }: {
  projectId: number;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (specId: number) => void;
}) {
  const { files } = useReferenceFiles(projectId);
  const [fileId, setFileId] = useState("");
  const [title, setTitle] = useState("");
  const { create } = useSpecMutations(projectId);
  const readable = (files ?? []).filter((f) => f.extract_status === "ready");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Track a spec</DialogTitle>
          <DialogDescription>
            Pick a document from the Documents tab. Its requirements are extracted by the
            project's AI provider; you can review and edit them before approving the spec.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label>Document</Label>
            <Select value={fileId} onValueChange={setFileId}>
              <SelectTrigger>
                <SelectValue placeholder={readable.length ? "Choose a document…" : "No documents with text yet"} />
              </SelectTrigger>
              <SelectContent>
                {readable.map((f) => (
                  <SelectItem key={f.id} value={String(f.id)}>
                    {f.filename}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="spec-title">Title (optional)</Label>
            <Input id="spec-title" value={title} onChange={(e) => setTitle(e.target.value)}
                   placeholder="Defaults to the file name" />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={!fileId || create.isPending}
            onClick={() =>
              create.mutate(
                { reference_file_id: Number(fileId), title: title.trim() || null },
                {
                  onSuccess: (spec) => {
                    setFileId("");
                    setTitle("");
                    onOpenChange(false);
                    onCreated(spec.id);
                  },
                },
              )
            }
          >
            {create.isPending ? "Creating…" : "Create spec"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SpecStatusBadges({ spec }: { spec: SpecSummary }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <StatusBadge
        variant={spec.status === "approved" ? "success" : "neutral"}
        label={spec.status === "approved" ? "Approved" : "Draft"}
      />
      {spec.version ? <Badge variant="outline">v{spec.version}</Badge> : null}
      <Badge variant="secondary">{spec.source === "repo" ? "Repository" : "Document"}</Badge>
      {spec.extract_status === "running" ? (
        <StatusBadge variant="running" label="Reading requirements" spinning />
      ) : spec.extract_status === "failed" ? (
        <StatusBadge variant="failed" label="Extraction failed" />
      ) : null}
    </span>
  );
}

function SpecList({ projectId, onOpen }: { projectId: number; onOpen: (id: number) => void }) {
  const { data: specs, isPending } = useSpecList(projectId);
  const canEdit = useAccess(projectId).can("spec");
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-4">
      {canEdit ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> Track a spec
          </Button>
        </div>
      ) : null}
      {isPending ? (
        <TableSkeleton />
      ) : !specs?.length ? (
        <EmptyState
          icon={FileCheck2}
          title="No specs tracked yet"
          hint="Upload a PRD or design doc on the Documents tab, then track it here to follow each requirement through to delivered work."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Spec</TableHead>
                  <TableHead className="w-24 text-right">Requirements</TableHead>
                  <TableHead className="w-80">Coverage</TableHead>
                  <TableHead className="w-40">Attention</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {specs.map((s) => (
                  <TableRow key={s.id} className="cursor-pointer align-top" onClick={() => onOpen(s.id)}>
                    <TableCell>
                      <div className="font-medium">{s.title}</div>
                      <div className="mt-1">
                        <SpecStatusBadges spec={s} />
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{s.coverage.total}</TableCell>
                    <TableCell>
                      <CoverageBars coverage={s.coverage} compact />
                    </TableCell>
                    <TableCell className="text-xs">
                      {s.coverage.total - s.coverage.linked > 0 ? (
                        <div className="text-warning">{s.coverage.total - s.coverage.linked} untraced</div>
                      ) : null}
                      {s.coverage.needs_review ? (
                        <div className="text-warning">{s.coverage.needs_review} link(s) to review</div>
                      ) : null}
                      {s.coverage.changed ? (
                        <div className="text-muted-foreground">{s.coverage.changed} changed in v{s.version}</div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <NewSpecDialog projectId={projectId} open={creating} onOpenChange={setCreating} onCreated={onOpen} />
    </div>
  );
}

type Filter = "all" | "untraced" | "changed" | "review";

const FILTERS: { key: Filter; label: string; test: (r: Requirement) => boolean }[] = [
  { key: "all", label: "All", test: () => true },
  { key: "untraced", label: "Untraced", test: (r) => r.status === "untraced" },
  { key: "changed", label: "Changed", test: (r) => r.change_state !== "unchanged" },
  { key: "review", label: "Needs review", test: (r) => r.tasks.some((t) => t.needs_review) },
];

function SpecHeader({ projectId, spec, onBack }: { projectId: number; spec: SpecDetail; onBack: () => void }) {
  const canEdit = useAccess(projectId).can("spec");
  const m = useSpecMutations(projectId, spec.id);
  const fileInput = useRef<HTMLInputElement>(null);
  const isDoc = spec.source === "document";
  const busy = spec.extract_status === "running";

  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> All specs
      </button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">{spec.title}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <SpecStatusBadges spec={spec} />
            {spec.filename ? <span>{spec.filename}</span> : null}
          </div>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-1.5">
            {spec.version ? (
              <Button size="sm" variant={spec.status === "approved" ? "outline" : "default"}
                      disabled={m.patch.isPending}
                      onClick={() => m.patch.mutate({ status: spec.status === "approved" ? "draft" : "approved" })}>
                {spec.status === "approved" ? "Back to draft" : "Approve spec"}
              </Button>
            ) : null}
            {isDoc ? (
              <>
                <input
                  ref={fileInput}
                  type="file"
                  className="hidden"
                  accept=".md,.txt,.html,.htm,.pdf,.pptx"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) m.uploadVersion.mutate(f);
                    e.target.value = "";
                  }}
                />
                <Button size="sm" variant="outline" disabled={busy || m.uploadVersion.isPending}
                        onClick={() => fileInput.current?.click()}>
                  <Upload className="size-3.5" /> New version
                </Button>
                {spec.extract_status === "failed" ? (
                  <Button size="sm" variant="outline" disabled={m.reExtract.isPending}
                          onClick={() => m.reExtract.mutate()}>
                    <RefreshCw className="size-3.5" /> Retry
                  </Button>
                ) : null}
              </>
            ) : null}
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="ghost" className="text-muted-foreground">
                  <Trash2 className="size-3.5" />
                  <span className="sr-only">Stop tracking</span>
                </Button>
              }
              title={`Stop tracking “${spec.title}”?`}
              description="Its requirements and task links are deleted. The document itself stays in Documents."
              confirmLabel="Stop tracking"
              onConfirm={() => m.remove.mutate(undefined, { onSuccess: onBack })}
            />
          </div>
        ) : null}
      </div>
      {busy ? (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <Loader2 className="size-4 animate-spin" />
          {spec.has_pending_version || spec.version
            ? "Reading the new version and comparing it with the current requirements…"
            : "Reading requirements from the document… this can take a minute."}
        </div>
      ) : spec.extract_status === "failed" && spec.extract_error ? (
        <ErrorAlert message={`Extraction failed: ${spec.extract_error}`} />
      ) : null}
    </div>
  );
}

function SpecView({ projectId, specId, onBack }: { projectId: number; specId: number; onBack: () => void }) {
  const { data: spec, isPending, error } = useSpec(specId);
  const access = useAccess(projectId);
  const m = useSpecMutations(projectId, specId);
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const rows = useMemo(
    () => (spec?.requirements ?? []).filter(FILTERS.find((f) => f.key === filter)!.test),
    [spec, filter],
  );

  if (isPending) return <TableSkeleton />;
  if (error || !spec) return <ErrorAlert message="Could not load this spec." />;
  const open = spec.requirements.find((r) => r.id === openId) ?? null;
  const latest = spec.revisions[0];

  return (
    <div className="space-y-4">
      <SpecHeader projectId={projectId} spec={spec} onBack={onBack} />

      {spec.version ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
          <Card>
            <CardContent className="p-4">
              <CoverageBars coverage={spec.coverage} />
            </CardContent>
          </Card>
          {latest && latest.version > 1 ? (
            <Card>
              <CardContent className="p-4 text-xs">
                <div className="mb-1 font-medium">Version {latest.version}</div>
                <div className="text-muted-foreground">
                  {latest.changes.added ?? 0} added · {latest.changes.changed ?? 0} changed ·{" "}
                  {latest.changes.removed ?? 0} removed
                </div>
                <div className="text-muted-foreground">{formatDateTime(latest.created_at)}</div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      {spec.requirements.length ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1">
              {FILTERS.map((f) => {
                const n = spec.requirements.filter(f.test).length;
                return (
                  <Button key={f.key} size="sm" variant={filter === f.key ? "secondary" : "ghost"}
                          className="h-7" onClick={() => setFilter(f.key)}>
                    {f.label} <span className="ml-1 font-mono text-xs text-muted-foreground">{n}</span>
                  </Button>
                );
              })}
            </div>
            {access.can("spec") && spec.source === "document" ? (
              <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                <Plus className="size-3.5" /> Add requirement
              </Button>
            ) : null}
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Key</TableHead>
                    <TableHead>Requirement</TableHead>
                    <TableHead className="w-32">Status</TableHead>
                    <TableHead className="w-56">Work</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}
                              className={cn("cursor-pointer align-top", r.status === "removed" && "opacity-60")}
                              onClick={() => setOpenId(r.id)}>
                      <TableCell className="font-mono text-xs">{r.key}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={cn("font-medium", r.status === "removed" && "line-through")}>
                            {r.title}
                          </span>
                          {r.priority ? (
                            <span className="text-[10px] uppercase text-muted-foreground">{r.priority}</span>
                          ) : null}
                          {changeBadge(r.change_state, r.changed_in_version)}
                        </div>
                        <div className="line-clamp-2 text-xs text-muted-foreground">{r.statement}</div>
                        {r.acceptance_criteria.length ? (
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            {r.acceptance_criteria.length} acceptance criteria
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>{requirementStatusBadge(r.status)}</TableCell>
                      <TableCell className="text-xs">
                        {r.tasks.length ? (
                          <div className="flex flex-wrap gap-1">
                            {r.tasks.slice(0, 4).map((t) => (
                              <span key={t.task_id}
                                    className={cn("rounded border px-1.5 py-0.5 font-mono",
                                      t.needs_review && "border-warning/50 text-warning")}
                                    title={`${t.title}${t.needs_review ? " — needs review" : ""}`}>
                                {t.key}
                              </span>
                            ))}
                            {r.tasks.length > 4 ? <span className="text-muted-foreground">+{r.tasks.length - 4}</span> : null}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!rows.length ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                        Nothing matches this filter.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : spec.extract_status !== "running" ? (
        <EmptyState icon={FileCheck2} title="No requirements yet"
                    hint={spec.extract_status === "failed" ? "Fix the problem above and retry." : undefined} />
      ) : null}

      <RequirementDialog projectId={projectId} spec={spec} requirement={open} onClose={() => setOpenId(null)} />
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a requirement</DialogTitle>
            <DialogDescription>
              Kept even when a new version of the document is uploaded, since it isn't in the document.
            </DialogDescription>
          </DialogHeader>
          <RequirementForm
            pending={m.addRequirement.isPending}
            submitLabel="Add"
            onSubmit={(draft) => m.addRequirement.mutate(draft, { onSuccess: () => setAdding(false) })}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Specs and their requirements, traced to the work that implements them. */
export function SpecsTab({ projectId }: { projectId: number }) {
  const [params, setParams] = useSearchParams();
  const specId = Number(params.get("spec")) || null;
  const go = (id: number | null) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (id === null) next.delete("spec");
      else next.set("spec", String(id));
      return next;
    });

  return (
    <TabShell tab="specs">
      {specId ? (
        <SpecView projectId={projectId} specId={specId} onBack={() => go(null)} />
      ) : (
        <SpecList projectId={projectId} onOpen={(id) => go(id)} />
      )}
    </TabShell>
  );
}
