import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, RefreshCw, TerminalSquare, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { XtermTerminal } from "@/components/terminal/XtermTerminal";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, ApiError } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type { ClaudeStatus, ClaudeTest, ClaudeTokenResult, ProjectDetail } from "@/types/api";

const MODEL_LABELS: Record<string, string> = {
  "": "Provider default",
  opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
};
const DEFAULT_MODEL = "__default__";

function AnalysisSettingsCard({
  projectId,
  project,
}: {
  projectId: number;
  project: ProjectDetail;
}) {
  const qc = useQueryClient();
  const patch = useMutation({
    mutationFn: (body: { analysis_provider?: string; analysis_model?: string }) =>
      api.patch<ProjectDetail>(`/projects/${projectId}`, body),
    onSuccess: (p) => {
      qc.setQueryData(qk.project(projectId), p);
      toast.success("Analysis settings saved");
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not save settings"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Analysis provider</CardTitle>
        <CardDescription>
          The LLM used for commit analysis, repo summaries, KPIs, deliverables, and reports.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-4">
        <div className="grid gap-1.5">
          <Label>Provider</Label>
          <Select
            value={project.analysis_provider}
            onValueChange={(v) => patch.mutate({ analysis_provider: v })}
          >
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {project.analysis_providers.map((p) => (
                <SelectItem key={p.key} value={p.key} disabled={!p.available}>
                  {p.label}
                  {!p.available ? " (unavailable)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Model</Label>
          <Select
            value={project.analysis_model || DEFAULT_MODEL}
            onValueChange={(v) =>
              patch.mutate({ analysis_model: v === DEFAULT_MODEL ? "" : v })
            }
          >
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {project.claude_models.map((m) => (
                <SelectItem key={m || DEFAULT_MODEL} value={m || DEFAULT_MODEL}>
                  {MODEL_LABELS[m] ?? m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}

function ClaudeStatusCard() {
  const qc = useQueryClient();
  const [showLogin, setShowLogin] = useState(false);
  const [testResult, setTestResult] = useState<ClaudeTest | null>(null);

  const { data: status } = useQuery({
    queryKey: qk.claudeStatus,
    queryFn: () => api.get<ClaudeStatus>("/provider/claude/status"),
  });

  const recheck = () => qc.invalidateQueries({ queryKey: qk.claudeStatus });
  const test = useMutation({
    mutationFn: () => api.post<ClaudeTest>("/provider/claude/test"),
    onSuccess: setTestResult,
    onError: (err: ApiError) => setTestResult({ ok: false, model: null, error: err.detail }),
  });
  const saveToken = useMutation({
    mutationFn: (token: string) => api.post<ClaudeTokenResult>("/provider/claude/token", { token }),
    onSuccess: (r) => {
      if (r.ok) {
        toast.success("Token saved");
        recheck();
      } else {
        toast.error(r.error || "Invalid token");
      }
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not save token"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Claude Code CLI
          <Button variant="ghost" size="sm" onClick={recheck}>
            <RefreshCw className="size-3.5" /> Recheck
          </Button>
        </CardTitle>
        <CardDescription>
          The CLI runs analysis jobs and powers the project terminal. Sign in once; the token is
          stored in the shared config volume.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {status?.version ? (
            <StatusBadge variant="success" label={`Installed · ${status.version}`} />
          ) : (
            <StatusBadge variant="failed" label="CLI not found" />
          )}
          {status?.authed ? (
            <StatusBadge variant="success" label="Signed in" />
          ) : (
            <StatusBadge variant="warning" label="Not signed in" />
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={test.isPending || !status?.version}
            onClick={() => test.mutate()}
          >
            {test.isPending ? "Testing…" : "Test connection"}
          </Button>
        </div>
        {testResult ? (
          <div
            className={`flex items-center gap-1.5 text-xs ${testResult.ok ? "text-success" : "text-destructive"}`}
          >
            {testResult.ok ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
            {testResult.ok ? `OK (model: ${testResult.model ?? "unknown"})` : testResult.error}
          </div>
        ) : null}

        <div className="space-y-2 rounded-lg border p-3">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Sign in
          </div>
          <p className="text-xs text-muted-foreground">
            Run <code className="rounded bg-muted px-1 font-mono">claude setup-token</code> in the
            terminal below, authorize in your browser, then paste the printed token here.
          </p>
          <Button variant="outline" size="sm" onClick={() => setShowLogin((v) => !v)}>
            <TerminalSquare className="size-4" />
            {showLogin ? "Hide terminal" : "Set up in terminal"}
          </Button>
          {showLogin ? (
            <XtermTerminal
              wsPath="/provider/claude/login/ws"
              sendBinary={false}
              fitToContainer={false}
              className="h-[420px] overflow-auto rounded-lg border bg-[#0b0f14] p-2"
              onClosed={recheck}
            />
          ) : null}
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const token = String(fd.get("token") ?? "").trim();
              if (token) saveToken.mutate(token);
              e.currentTarget.reset();
            }}
          >
            <div className="grid min-w-64 flex-1 gap-1.5">
              <Label htmlFor="claude-token">Long-lived token</Label>
              <Input
                id="claude-token"
                name="token"
                type="password"
                placeholder="sk-ant-…"
                autoComplete="off"
              />
            </div>
            <Button type="submit" size="sm" variant="outline" disabled={saveToken.isPending}>
              <KeyRound className="size-4" />
              {saveToken.isPending ? "Saving…" : "Save token"}
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}

export function ProviderTab({
  projectId,
  project,
}: {
  projectId: number;
  project: ProjectDetail;
}) {
  return (
    <div className="space-y-4">
      <AnalysisSettingsCard projectId={projectId} project={project} />
      <ClaudeStatusCard />
    </div>
  );
}
