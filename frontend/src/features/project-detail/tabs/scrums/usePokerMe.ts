import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { api } from "@/lib/api";
import { useAccess } from "@/lib/permissions";
import { qk } from "@/lib/query-keys";
import type { Member, ProjectMembers } from "@/types/api";

const storageKey = (projectId: number) => `eaglyssier:poker:${projectId}:me`;

/**
 * Which member the person at this browser is voting as.
 *
 * A signed-in user who is on the project always votes as their own member —
 * the server refuses votes cast for anyone else. The local choice below is
 * only the fallback for admins who aren't on the project. It's kept in
 * localStorage rather than only in the URL on purpose: with a `?me=` param
 * alone, pasting the session link into Slack would make everyone the same
 * voter. The param is still honoured so a link can pre-select someone, and it's
 * mirrored into storage on read.
 *
 * The stored id is validated against the project's members every render, so a
 * member removed from the project doesn't leave a ghost voter behind.
 */
export function usePokerMe(projectId: number) {
  const [params, setParams] = useSearchParams();
  const paramValue = Number(params.get("me")) || null;
  const [stored, setStored] = useState<number | null>(null);

  // Read once on mount; localStorage is unavailable during SSR-style renders
  // and can throw in private-mode Safari, so it's guarded.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey(projectId));
      setStored(Number(raw) || null);
    } catch {
      /* storage unavailable — the param alone still works */
    }
  }, [projectId]);

  const { data: members } = useQuery({
    queryKey: qk.projectMembers(projectId),
    queryFn: () => api.get<ProjectMembers>(`/projects/${projectId}/members`),
    enabled: Number.isFinite(projectId),
  });

  const { memberId: ownId } = useAccess(projectId);
  const candidates: Member[] = members?.members ?? [];
  const own = candidates.some((m) => m.id === ownId) ? ownId : null;
  const resolvedId = own ?? paramValue ?? stored;
  const me = candidates.find((m) => m.id === resolvedId) ?? null;

  const choose = useCallback(
    (memberId: number | null) => {
      try {
        if (memberId === null) window.localStorage.removeItem(storageKey(projectId));
        else window.localStorage.setItem(storageKey(projectId), String(memberId));
      } catch {
        /* storage unavailable */
      }
      setStored(memberId);
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (memberId === null) next.delete("me");
          else next.set("me", String(memberId));
          return next;
        },
        { replace: true },
      );
    },
    [projectId, setParams],
  );

  // A param pointing at someone who isn't on the project is worse than nothing:
  // it silently sticks. Clear it so the gate reappears.
  useEffect(() => {
    if (paramValue && candidates.length && !candidates.some((m) => m.id === paramValue)) {
      choose(null);
    }
  }, [paramValue, candidates, choose]);

  return { me, candidates, choose, membersLoaded: Boolean(members) };
}
