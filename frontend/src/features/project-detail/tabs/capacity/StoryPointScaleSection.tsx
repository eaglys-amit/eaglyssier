import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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
import type { StoryPointRow } from "@/types/api";

const RISKS = ["None", "Low", "Normal", "Moderate", "High"];

/** Per-project story-point reference scale (points -> hour band + risk). */
export function StoryPointScaleSection({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: qk.storyPoints(projectId),
    queryFn: () => api.get<StoryPointRow[]>(`/projects/${projectId}/story-points`),
  });
  const [rows, setRows] = useState<StoryPointRow[]>([]);
  useEffect(() => {
    if (data) setRows(data.map((r) => ({ ...r })));
  }, [data]);

  const save = useMutation({
    mutationFn: (body: StoryPointRow[]) =>
      api.put<StoryPointRow[]>(`/projects/${projectId}/story-points`, {
        rows: body.map(({ id: _id, ...rest }) => rest),
      }),
    onSuccess: (saved) => {
      qc.setQueryData(qk.storyPoints(projectId), saved);
      toast.success("Story-point scale saved");
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not save scale"),
  });

  const update = (i: number, patch: Partial<StoryPointRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight">Story-point scale</h2>
          <p className="text-xs text-muted-foreground">
            Reference mapping points to a time band &amp; risk. Saving replaces the whole
            scale; duplicate point values are dropped.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => save.mutate(rows)} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save scale"}
        </Button>
      </div>
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">Points</TableHead>
              <TableHead className="w-24">Min hrs</TableHead>
              <TableHead className="w-24">Max hrs</TableHead>
              <TableHead className="w-32">Risk</TableHead>
              <TableHead className="w-24">Break down</TableHead>
              <TableHead>Note</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => (
              <TableRow key={i}>
                <TableCell>
                  <Input
                    type="number"
                    min={0}
                    value={row.points}
                    onChange={(e) => update(i, { points: Number(e.target.value) })}
                    className="h-8 font-mono tabular-nums"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    step="0.5"
                    min={0}
                    value={row.min_hours ?? ""}
                    onChange={(e) =>
                      update(i, {
                        min_hours: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    className="h-8 font-mono tabular-nums"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    step="0.5"
                    min={0}
                    value={row.max_hours ?? ""}
                    onChange={(e) =>
                      update(i, {
                        max_hours: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    className="h-8 font-mono tabular-nums"
                  />
                </TableCell>
                <TableCell>
                  <Select value={row.risk} onValueChange={(v) => update(i, { risk: v })}>
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RISKS.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Checkbox
                    checked={row.needs_breakdown}
                    onCheckedChange={(v) => update(i, { needs_breakdown: v === true })}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={row.note ?? ""}
                    onChange={(e) => update(i, { note: e.target.value || null })}
                    className="h-8"
                  />
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-destructive hover:text-destructive"
                    onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-4" />
                    <span className="sr-only">Remove row</span>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="border-t p-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setRows((rs) => [
                ...rs,
                {
                  points: (rs.at(-1)?.points ?? 0) + 1,
                  min_hours: null,
                  max_hours: null,
                  risk: "None",
                  needs_breakdown: false,
                  note: null,
                },
              ])
            }
          >
            <Plus className="size-4" /> Add row
          </Button>
        </div>
      </div>
    </div>
  );
}
