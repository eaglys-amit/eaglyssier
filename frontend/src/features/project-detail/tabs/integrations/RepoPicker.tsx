import { useMutation } from "@tanstack/react-query";
import { ExternalLink, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ErrorAlert } from "@/components/shared/ErrorAlert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { DiscoveredRepo, RepoDiscovery } from "@/types/api";

const COPY: Record<string, { ownerLabel: string; ownerHint: string; noun: string }> = {
  github: {
    ownerLabel: "Owner",
    ownerHint: "Organization or user — leave empty for everything the token can reach",
    noun: "repositories",
  },
  gitlab: {
    ownerLabel: "Group / namespace",
    ownerHint: "Group (subgroups included) or user — leave empty for everything the token can reach",
    noun: "projects",
  },
};

/**
 * Owner + token in, a checkbox list out. The list is fetched on demand and is
 * never itself persisted: only the checked full names go into the integration
 * config, which is what sync reads.
 */
export function RepoPicker({
  projectId,
  type,
  owner,
  onOwnerChange,
  baseUrl,
  token,
  hasSavedToken,
  selected,
  onChange,
}: {
  projectId: number;
  type: string;
  owner: string;
  onOwnerChange: (owner: string) => void;
  baseUrl: string;
  token: string;
  hasSavedToken: boolean;
  selected: string[];
  onChange: (selected: string[]) => void;
}) {
  const [filter, setFilter] = useState("");
  const copy = COPY[type] ?? COPY.github;

  const list = useMutation({
    mutationFn: () =>
      api.post<RepoDiscovery>(`/projects/${projectId}/integrations/${type}/repos`, {
        owner: owner.trim() || null,
        base_url: baseUrl.trim() || null,
        token: token.trim() || null,
      }),
  });

  // Editing an already-connected integration: the saved token and owner are
  // enough to show the list straight away, without a click.
  const fetchList = list.mutate;
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoRan.current || !hasSavedToken) return;
    autoRan.current = true;
    fetchList();
  }, [hasSavedToken, fetchList]);

  const repos = list.data?.repos;
  const canFetch = Boolean(token.trim() || hasSavedToken);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!repos) return [];
    if (!q) return repos;
    return repos.filter(
      (r) =>
        r.full_name.toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q),
    );
  }, [repos, filter]);

  // Anything already configured that this listing does not cover — another
  // owner, a rename, a repo the token lost access to. Kept visible so it can be
  // unchecked deliberately rather than vanishing on save.
  const known = new Set(repos?.map((r) => r.full_name));
  const orphans = repos ? selected.filter((s) => !known.has(s)) : [];

  const toggle = (fullName: string) =>
    onChange(
      selected.includes(fullName)
        ? selected.filter((s) => s !== fullName)
        : [...selected, fullName],
    );

  const visibleNames = visible.map((r) => r.full_name);
  const allVisibleSelected =
    visibleNames.length > 0 && visibleNames.every((n) => selected.includes(n));

  return (
    <div className="grid gap-2 sm:col-span-2">
      <div className="grid gap-1.5">
        <Label htmlFor={`${type}-owner`}>{copy.ownerLabel}</Label>
        <div className="flex gap-2">
          <Input
            id={`${type}-owner`}
            value={owner}
            onChange={(e) => onOwnerChange(e.target.value)}
            placeholder={type === "github" ? "my-org" : "my-group"}
            className="font-mono text-xs"
          />
          <Button
            type="button"
            variant="outline"
            disabled={!canFetch || list.isPending}
            onClick={() => list.mutate()}
          >
            <RefreshCw className={list.isPending ? "size-4 animate-spin" : "size-4"} />
            {list.isPending ? "Loading…" : repos ? "Refresh" : `Fetch ${copy.noun}`}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {canFetch
            ? copy.ownerHint
            : `Enter a token above, then fetch the ${copy.noun} to pick from.`}
        </p>
      </div>

      {list.error ? <ErrorAlert message={(list.error as ApiError).detail} /> : null}

      {repos ? (
        <div className="rounded-lg border">
          <div className="flex flex-wrap items-center gap-2 border-b px-2 py-1.5">
            <div className="relative min-w-40 flex-1">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter…"
                className="h-8 pl-7 text-xs"
              />
            </div>
            <span className="text-xs text-muted-foreground">
              {selected.length} selected of {repos.length}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!visibleNames.length}
              onClick={() =>
                onChange(
                  allVisibleSelected
                    ? selected.filter((s) => !visibleNames.includes(s))
                    : [...new Set([...selected, ...visibleNames])],
                )
              }
            >
              {allVisibleSelected ? "Clear shown" : "Select shown"}
            </Button>
          </div>

          {!repos.length ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              The token cannot see any {copy.noun} for this {copy.ownerLabel.toLowerCase()}.
            </p>
          ) : !visible.length ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">No match for “{filter}”.</p>
          ) : (
            <ul className="max-h-72 divide-y overflow-y-auto">
              {visible.map((r) => (
                <RepoRow
                  key={r.full_name}
                  repo={r}
                  checked={selected.includes(r.full_name)}
                  onToggle={() => toggle(r.full_name)}
                />
              ))}
            </ul>
          )}

          {orphans.length ? (
            <div className="border-t bg-muted/30 px-3 py-2">
              <p className="mb-1 text-xs text-muted-foreground">
                Selected but not in this listing — uncheck to drop:
              </p>
              <ul className="space-y-1">
                {orphans.map((name) => (
                  <li key={name}>
                    <label className="flex items-center gap-2 text-xs">
                      <Checkbox checked onCheckedChange={() => toggle(name)} />
                      <span className="font-mono">{name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : selected.length ? (
        <div className="rounded-lg border px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{selected.length}</span> {copy.noun}{" "}
          configured: <span className="font-mono">{selected.join(", ")}</span>
        </div>
      ) : null}
    </div>
  );
}

function RepoRow({
  repo,
  checked,
  onToggle,
}: {
  repo: DiscoveredRepo;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="flex items-start gap-2 px-3 py-2 hover:bg-muted/40">
      <Checkbox
        id={`repo-${repo.full_name}`}
        checked={checked}
        onCheckedChange={onToggle}
        className="mt-0.5"
      />
      <label htmlFor={`repo-${repo.full_name}`} className="min-w-0 flex-1 cursor-pointer">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-xs font-medium">{repo.full_name}</span>
          {repo.private ? (
            <Badge variant="secondary" className="text-[10px]">
              private
            </Badge>
          ) : null}
          {repo.archived ? (
            <Badge variant="secondary" className="text-[10px]">
              archived
            </Badge>
          ) : null}
          {repo.updated_at ? (
            <span className="text-[11px] text-muted-foreground">
              updated {formatDate(repo.updated_at)}
            </span>
          ) : null}
        </span>
        {repo.description ? (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {repo.description}
          </span>
        ) : null}
      </label>
      {repo.url ? (
        <a
          href={repo.url}
          target="_blank"
          rel="noreferrer"
          className="mt-0.5 text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="size-3.5" />
          <span className="sr-only">Open {repo.full_name}</span>
        </a>
      ) : null}
    </li>
  );
}
