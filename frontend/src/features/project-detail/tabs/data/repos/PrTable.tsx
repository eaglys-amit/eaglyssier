import { useQuery } from "@tanstack/react-query";

import { Spinner } from "@/components/shared/Spinner";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import type { PullRequest } from "@/types/api";

import { byMember, Diff } from "./repo-utils";

export function PrTable({ repoId, memberId }: { repoId: number; memberId: number | null }) {
  const { data: allPrs, isPending } = useQuery({
    queryKey: qk.pulls(repoId),
    queryFn: () => api.get<PullRequest[]>(`/repos/${repoId}/pulls`),
  });

  if (isPending) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Spinner /> Loading pull requests…
      </div>
    );
  }
  if (!allPrs?.length) {
    return <p className="p-4 text-sm text-muted-foreground">No pull requests synced.</p>;
  }
  const prs = byMember(allPrs, memberId);
  if (!prs.length) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        No pull requests by the selected person.
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-16">#</TableHead>
          <TableHead>Title</TableHead>
          <TableHead className="w-24">State</TableHead>
          <TableHead className="w-40">Author</TableHead>
          <TableHead className="w-28 text-right">Diff</TableHead>
          <TableHead className="w-24 text-right">Reviews</TableHead>
          <TableHead className="w-28">Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {prs.map((pr) => (
          <TableRow key={pr.id}>
            <TableCell className="font-mono text-xs">#{pr.external_id}</TableCell>
            <TableCell className="max-w-md truncate">{pr.title || "—"}</TableCell>
            <TableCell>
              <Badge
                variant={pr.state === "merged" ? "default" : "secondary"}
                className={pr.state === "merged" ? "bg-primary/85" : undefined}
              >
                {pr.state ?? "—"}
              </Badge>
            </TableCell>
            <TableCell className="truncate text-muted-foreground">
              {pr.author_name || "—"}
            </TableCell>
            <TableCell className="text-right">
              <Diff additions={pr.additions} deletions={pr.deletions} />
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {pr.reviews.length}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
              {formatDate(pr.created_at_src)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
