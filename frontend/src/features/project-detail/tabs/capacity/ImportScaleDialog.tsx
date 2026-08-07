import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/EmptyState";
import { Spinner } from "@/components/shared/Spinner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, ApiError } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type { StoryPointRow, StoryPointScaleSource } from "@/types/api";
import { Download } from "lucide-react";

/** Copy another project's story-point scale instead of retyping it. */
export function ImportScaleDialog({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<string>("");
  const [mode, setMode] = useState<"replace" | "merge">("replace");

  const { data: sources, isPending } = useQuery({
    queryKey: qk.scaleSources(projectId),
    queryFn: () => api.get<StoryPointScaleSource[]>(`/projects/${projectId}/story-points/sources`),
    enabled: open,
  });

  const importScale = useMutation({
    mutationFn: () =>
      api.post<StoryPointRow[]>(`/projects/${projectId}/story-points/import`, {
        source_project_id: Number(source),
        mode,
      }),
    onSuccess: (rows) => {
      qc.setQueryData(qk.storyPoints(projectId), rows);
      // The deck and the violation list are both derived from the scale.
      qc.invalidateQueries({ queryKey: qk.deck(projectId) });
      qc.invalidateQueries({ queryKey: qk.scaleViolations(projectId) });
      setOpen(false);
      toast.success(`Imported ${rows.length} scale rows`);
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not import the scale"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Download className="size-4" /> Import…
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import a story-point scale</DialogTitle>
          <DialogDescription>
            Copy the scale from another project so estimates mean the same thing across both.
          </DialogDescription>
        </DialogHeader>

        {isPending ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Spinner /> Looking for scales…
          </div>
        ) : !sources?.length ? (
          <EmptyState
            icon={Download}
            title="No other project has a scale yet"
            hint="Every project gets the default scale on first view, so this fills in once there's a second project."
          />
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="source">Copy from</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger id="source">
                  <SelectValue placeholder="Pick a project" />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((s) => (
                    <SelectItem key={s.project_id} value={String(s.project_id)}>
                      {s.project_name}
                      {s.project_key ? ` (${s.project_key})` : ""} · {s.row_count} rows
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <RadioGroup
              value={mode}
              onValueChange={(v) => setMode(v as "replace" | "merge")}
              className="gap-3"
            >
              <div className="flex items-start gap-2">
                <RadioGroupItem value="replace" id="mode-replace" className="mt-0.5" />
                <Label htmlFor="mode-replace" className="font-normal">
                  Replace
                  <span className="block text-xs text-muted-foreground">
                    Mirror the source exactly. Anything you've tuned here is lost.
                  </span>
                </Label>
              </div>
              <div className="flex items-start gap-2">
                <RadioGroupItem value="merge" id="mode-merge" className="mt-0.5" />
                <Label htmlFor="mode-merge" className="font-normal">
                  Merge
                  <span className="block text-xs text-muted-foreground">
                    Keep the rows this project already defines and only add missing point values.
                  </span>
                </Label>
              </div>
            </RadioGroup>
          </div>
        )}

        <DialogFooter>
          <Button
            onClick={() => importScale.mutate()}
            disabled={!source || importScale.isPending}
          >
            {importScale.isPending ? "Importing…" : "Import scale"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
