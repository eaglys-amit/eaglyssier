import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/EmptyState";
import { PlatformIcon } from "@/components/shared/PlatformIcon";
import { Spinner } from "@/components/shared/Spinner";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, ApiError } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type {
  Member,
  MemberSyncApplyIn,
  MemberSyncApplyOut,
  MemberSyncCandidate,
  MemberSyncPreview,
  ProjectMembers,
} from "@/types/api";

/** Sentinel values for the per-row target Select (Radix forbids null/""). */
const SKIP = "skip";
const CREATE = "create";

type Decision = { target: string; checked: boolean };

/**
 * Review and confirm identity -> member matches.
 *
 * Sync discovers an account for every external identity it sees but never
 * creates a member, so mapping is one manual click per account and mostly
 * doesn't happen — which silently starves KPI, capacity and evaluation of data.
 * This proposes the whole set at once. It stays a *review*: an email match is
 * solid, but a name or handle match is a guess, and attributing one person's
 * commits to another is worse than leaving a row unmapped.
 */
export function SyncMembersDialog({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});

  const { data: preview, isPending } = useQuery({
    queryKey: qk.memberSyncPreview(projectId),
    queryFn: () => api.get<MemberSyncPreview>(`/projects/${projectId}/members/sync-preview`),
    enabled: open,
    // Always re-derive on open: a sync may have discovered accounts since.
    staleTime: 0,
  });

  const { data: members } = useQuery({
    queryKey: qk.projectMembers(projectId),
    queryFn: () => api.get<ProjectMembers>(`/projects/${projectId}/members`),
    enabled: open,
  });
  const allMembers: Member[] = members ? [...members.members, ...members.available] : [];

  // Seed from the proposals: exact matches pre-checked, guesses left for the
  // user to tick. Only unmapped rows are actionable.
  useEffect(() => {
    if (!preview) return;
    const seeded: Record<number, Decision> = {};
    for (const c of preview.candidates) {
      if (c.current_member_id !== null) continue;
      seeded[c.identity_id] = {
        target: c.match_member_id ? String(c.match_member_id) : SKIP,
        checked: c.confidence === "exact",
      };
    }
    setDecisions(seeded);
  }, [preview]);

  const apply = useMutation({
    mutationFn: (body: MemberSyncApplyIn) =>
      api.post<MemberSyncApplyOut>(`/projects/${projectId}/members/sync-apply`, body),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: qk.projectMembers(projectId) });
      qc.invalidateQueries({ queryKey: qk.members });
      qc.invalidateQueries({ queryKey: qk.memberSyncPreview(projectId) });
      // Everything member-scoped is now different.
      qc.invalidateQueries({ queryKey: qk.project(projectId) });
      setOpen(false);
      toast.success(
        `Mapped ${result.mapped} ${result.mapped === 1 ? "account" : "accounts"}` +
          (result.created
            ? `, created ${result.created} ${result.created === 1 ? "member" : "members"}`
            : ""),
      );
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not apply the mapping"),
  });

  const pending = preview?.candidates.filter((c) => c.current_member_id === null) ?? [];
  const selected = pending.filter((c) => decisions[c.identity_id]?.checked);
  const set = (id: number, patch: Partial<Decision>) =>
    setDecisions((d) => ({ ...d, [id]: { ...d[id], ...patch } }));

  const submit = () => {
    const body: MemberSyncApplyIn = { mappings: [], create_members: [] };
    for (const c of selected) {
      const target = decisions[c.identity_id].target;
      if (target === SKIP) continue;
      if (target === CREATE) {
        body.create_members.push({
          identity_id: c.identity_id,
          display_name: c.suggested_display_name,
          primary_email: c.email,
        });
      } else {
        body.mappings.push({ identity_id: c.identity_id, member_id: Number(target) });
      }
    }
    apply.mutate(body);
  };

  const actionable = selected.filter((c) => decisions[c.identity_id].target !== SKIP).length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <UserCheck className="size-4" /> Match accounts…
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Match discovered accounts to members</DialogTitle>
          <DialogDescription>
            Matches on email are reliable. Matches on a name or a git handle are guesses —
            check them before applying. Nothing is written until you do.
          </DialogDescription>
        </DialogHeader>

        {isPending ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Spinner /> Matching accounts…
          </div>
        ) : !pending.length ? (
          <EmptyState
            icon={UserCheck}
            title="Every discovered account is already mapped"
            hint={
              preview
                ? `${preview.already_mapped} of ${preview.total} accounts are linked to a member.`
                : undefined
            }
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>
                {preview!.already_mapped} already mapped · {preview!.matched} proposed ·{" "}
                {preview!.unmatched} with no match
              </span>
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  setDecisions((d) =>
                    Object.fromEntries(
                      Object.entries(d).map(([k, v]) => [
                        k,
                        { ...v, checked: v.target !== SKIP },
                      ]),
                    ),
                  )
                }
              >
                Select all with a target
              </Button>
            </div>

            <div className="max-h-96 divide-y overflow-y-auto rounded-lg border">
              {pending.map((c) => (
                <CandidateRow
                  key={c.identity_id}
                  candidate={c}
                  members={allMembers}
                  decision={decisions[c.identity_id]}
                  onChange={(patch) => set(c.identity_id, patch)}
                />
              ))}
            </div>
          </>
        )}

        <DialogFooter>
          <Button onClick={submit} disabled={!actionable || apply.isPending}>
            {apply.isPending
              ? "Applying…"
              : `Apply ${actionable} ${actionable === 1 ? "match" : "matches"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CandidateRow({
  candidate,
  members,
  decision,
  onChange,
}: {
  candidate: MemberSyncCandidate;
  members: Member[];
  decision: Decision | undefined;
  onChange: (patch: Partial<Decision>) => void;
}) {
  const account =
    candidate.display_name || candidate.username || candidate.email || candidate.external_id;

  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <Checkbox
        checked={decision?.checked ?? false}
        onCheckedChange={(v) => onChange({ checked: v === true })}
        className="mt-1"
        aria-label={`Apply the match for ${account}`}
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <PlatformIcon platform={candidate.system} size={14} />
          <span className="truncate text-sm font-medium">{account}</span>
          {candidate.confidence === "exact" ? (
            <StatusBadge variant="success" label="email match" />
          ) : candidate.confidence === "likely" ? (
            <StatusBadge
              variant="warning"
              label={candidate.match_reason === "username" ? "handle guess" : "name guess"}
            />
          ) : (
            <Badge variant="secondary">no match</Badge>
          )}
          {candidate.match_member_id && !candidate.match_on_project ? (
            <Badge variant="outline" className="text-[10px]">
              will join the project
            </Badge>
          ) : null}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {candidate.username ? <span className="font-mono">{candidate.username}</span> : null}
          {candidate.username && candidate.email ? " · " : null}
          {candidate.email}
        </div>
      </div>

      <Select
        value={decision?.target ?? SKIP}
        onValueChange={(target) => onChange({ target, checked: target !== SKIP })}
      >
        <SelectTrigger size="sm" className="w-56 shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SKIP}>Leave unmapped</SelectItem>
          <SelectItem value={CREATE}>
            Create “{candidate.suggested_display_name}”
          </SelectItem>
          {members.map((m) => (
            <SelectItem key={m.id} value={String(m.id)}>
              {m.display_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
