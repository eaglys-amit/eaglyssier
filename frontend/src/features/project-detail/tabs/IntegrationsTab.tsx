import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Plug, Plus, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { PlatformIcon } from "@/components/shared/PlatformIcon";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type { Integration, ProjectIntegrations, TestResult } from "@/types/api";

const FORM_HELP: Record<string, { baseUrl: string; token: string }> = {
  jira: {
    baseUrl: "https://your-org.atlassian.net",
    token: "API token (with the account email below)",
  },
  github: { baseUrl: "Leave empty for github.com", token: "Personal access token" },
  gitlab: { baseUrl: "https://gitlab.com or self-hosted URL", token: "Personal access token" },
};

function ConnectForm({
  projectId,
  type,
  existing,
  onDone,
}: {
  projectId: number;
  type: string;
  existing: Integration | null;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const cfg = (existing?.config ?? {}) as Record<string, unknown>;
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);

  const save = useMutation({
    mutationFn: (body: { base_url: string; token: string; config: Record<string, unknown> }) =>
      api.put<Integration>(`/projects/${projectId}/integrations/${type}`, {
        base_url: body.base_url || null,
        token: body.token || null,
        enabled,
        config: body.config,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.integrations(projectId) });
      toast.success("Integration saved");
      onDone();
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not save integration"),
  });

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const val = (k: string) => String(fd.get(k) ?? "").trim();
        const config: Record<string, unknown> = {};
        if (type === "jira") {
          config.email = val("email");
          config.project_key = val("project_key");
          if (val("board_id")) config.board_id = val("board_id");
          if (val("story_points_field")) config.story_points_field = val("story_points_field");
        } else if (type === "github") {
          config.repos = val("repos");
          if (val("max_commits")) config.max_commits = val("max_commits");
        } else if (type === "gitlab") {
          config.projects = val("projects");
          if (val("max_commits")) config.max_commits = val("max_commits");
        }
        save.mutate({ base_url: val("base_url"), token: val("token"), config });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`${type}-base-url`}>Base URL</Label>
          <Input
            id={`${type}-base-url`}
            name="base_url"
            defaultValue={existing?.base_url ?? ""}
            placeholder={FORM_HELP[type]?.baseUrl}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${type}-token`}>Token</Label>
          <Input
            id={`${type}-token`}
            name="token"
            type="password"
            placeholder={
              existing?.has_credentials ? "Leave blank to keep saved token" : FORM_HELP[type]?.token
            }
          />
        </div>

        {type === "jira" ? (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor="jira-email">Account email</Label>
              <Input
                id="jira-email"
                name="email"
                type="email"
                defaultValue={(cfg.email as string) ?? ""}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="jira-project-key">Project key</Label>
              <Input
                id="jira-project-key"
                name="project_key"
                defaultValue={(cfg.project_key as string) ?? ""}
                placeholder="ABC"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="jira-board-id">Board ID (optional)</Label>
              <Input
                id="jira-board-id"
                name="board_id"
                type="number"
                defaultValue={cfg.board_id != null ? String(cfg.board_id) : ""}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="jira-spf">Story-points field (optional)</Label>
              <Input
                id="jira-spf"
                name="story_points_field"
                defaultValue={(cfg.story_points_field as string) ?? ""}
                placeholder="customfield_10016"
              />
            </div>
          </>
        ) : null}

        {type === "github" || type === "gitlab" ? (
          <>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor={`${type}-repos`}>
                {type === "github" ? "Repositories" : "Projects"} (one per line or comma-separated)
              </Label>
              <Textarea
                id={`${type}-repos`}
                name={type === "github" ? "repos" : "projects"}
                rows={3}
                defaultValue={((cfg.repos ?? cfg.projects ?? []) as string[]).join("\n")}
                placeholder={type === "github" ? "owner/repo" : "group/project"}
                className="font-mono text-xs"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${type}-max-commits`}>Max commits per sync (optional)</Label>
              <Input
                id={`${type}-max-commits`}
                name="max_commits"
                type="number"
                defaultValue={cfg.max_commits != null ? String(cfg.max_commits) : ""}
              />
            </div>
          </>
        ) : null}
      </div>

      <div className="flex items-center justify-between pt-1">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={enabled} onCheckedChange={setEnabled} /> Enabled
        </label>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function PlatformCard({
  projectId,
  type,
  label,
  configurable,
  integration,
}: {
  projectId: number;
  type: string;
  label: string;
  configurable: boolean;
  integration: Integration | null;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const test = useMutation({
    mutationFn: () => api.post<TestResult>(`/integrations/${integration!.id}/test`),
    onSuccess: setTestResult,
    onError: (err: ApiError) => setTestResult({ ok: false, message: err.detail }),
  });
  const disconnect = useMutation({
    mutationFn: () => api.delete(`/integrations/${integration!.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.integrations(projectId) });
      toast.success(`${label} disconnected`);
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not disconnect"),
  });

  const cfg = (integration?.config ?? {}) as Record<string, unknown>;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <PlatformIcon platform={type} size={18} />
          {label}
          {integration ? (
            integration.enabled ? (
              <StatusBadge variant="success" label="Connected" />
            ) : (
              <StatusBadge variant="neutral" label="Disabled" />
            )
          ) : configurable ? (
            <StatusBadge variant="neutral" label="Not connected" />
          ) : (
            <StatusBadge variant="neutral" label="Coming soon" />
          )}
        </CardTitle>
        {configurable && integration && !editing ? (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={test.isPending}
              onClick={() => test.mutate()}
            >
              {test.isPending ? "Testing…" : "Test"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <ConfirmDialog
              trigger={
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                  <span className="sr-only">Disconnect</span>
                </Button>
              }
              title={`Disconnect ${label}?`}
              description="Removes the stored credentials and configuration. Synced data stays."
              confirmLabel="Disconnect"
              onConfirm={() => disconnect.mutate()}
            />
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        {!configurable ? (
          <CardDescription>Planned for a later iteration.</CardDescription>
        ) : editing ? (
          <ConnectForm
            projectId={projectId}
            type={type}
            existing={integration}
            onDone={() => setEditing(false)}
          />
        ) : integration ? (
          <div className="space-y-2 text-sm">
            <dl className="grid grid-cols-[7rem_1fr] gap-y-1 text-sm">
              <dt className="text-muted-foreground">Base URL</dt>
              <dd className="truncate">{integration.base_url || "default"}</dd>
              <dt className="text-muted-foreground">Credentials</dt>
              <dd>{integration.has_credentials ? "Saved" : "Missing"}</dd>
              {type === "jira" ? (
                <>
                  <dt className="text-muted-foreground">Project key</dt>
                  <dd className="font-mono">{(cfg.project_key as string) || "—"}</dd>
                </>
              ) : (
                <>
                  <dt className="text-muted-foreground">
                    {type === "github" ? "Repos" : "Projects"}
                  </dt>
                  <dd className="font-mono text-xs">
                    {((cfg.repos ?? cfg.projects ?? []) as string[]).join(", ") || "—"}
                  </dd>
                </>
              )}
            </dl>
            {testResult ? (
              <div
                className={`flex items-center gap-1.5 text-xs ${testResult.ok ? "text-success" : "text-destructive"}`}
              >
                {testResult.ok ? (
                  <CheckCircle2 className="size-3.5" />
                ) : (
                  <XCircle className="size-3.5" />
                )}
                {testResult.message}
              </div>
            ) : null}
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Plus className="size-4" /> Connect {label}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function IntegrationsTab({ projectId }: { projectId: number }) {
  const { data } = useQuery({
    queryKey: qk.integrations(projectId),
    queryFn: () => api.get<ProjectIntegrations>(`/projects/${projectId}/integrations`),
  });

  if (!data) return null;
  const byType = new Map(data.items.map((i) => [i.type, i]));

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Plug className="size-4" />
        Connect the platforms this project pulls data from. Tokens are encrypted at rest.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {data.types.map((t) => (
          <PlatformCard
            key={t.key}
            projectId={projectId}
            type={t.key}
            label={t.label}
            configurable={t.configurable}
            integration={byType.get(t.key) ?? null}
          />
        ))}
      </div>
    </div>
  );
}
