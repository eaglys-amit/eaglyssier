import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/PageHeader";
import { TableSkeleton } from "@/components/shared/TableSkeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

export function StoryPointsPage() {
  const qc = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: qk.storyPoints,
    queryFn: () => api.get<StoryPointRow[]>("/settings/story-points"),
  });
  const [rows, setRows] = useState<StoryPointRow[]>([]);
  useEffect(() => {
    if (data) setRows(data.map((r) => ({ ...r })));
  }, [data]);

  const save = useMutation({
    mutationFn: (body: StoryPointRow[]) =>
      api.put<StoryPointRow[]>("/settings/story-points", {
        rows: body.map(({ id: _id, ...rest }) => rest),
      }),
    onSuccess: (saved) => {
      qc.setQueryData(qk.storyPoints, saved);
      toast.success("Story-point scale saved");
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not save scale"),
  });

  const update = (i: number, patch: Partial<StoryPointRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <>
      <PageHeader
        title="Story points"
        description="Reference scale mapping points to a time band and risk; used as estimation guidance and to flag outliers."
        actions={
          <Button size="sm" onClick={() => save.mutate(rows)} disabled={save.isPending || isPending}>
            {save.isPending ? "Saving…" : "Save scale"}
          </Button>
        }
      />
      {isPending ? (
        <TableSkeleton />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Scale</CardTitle>
            <CardDescription>
              Saving replaces the whole scale. Duplicate point values are dropped.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Points</TableHead>
                  <TableHead className="w-28">Min hours</TableHead>
                  <TableHead className="w-28">Max hours</TableHead>
                  <TableHead className="w-36">Risk</TableHead>
                  <TableHead className="w-32">Break down</TableHead>
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
          </CardContent>
        </Card>
      )}
    </>
  );
}
