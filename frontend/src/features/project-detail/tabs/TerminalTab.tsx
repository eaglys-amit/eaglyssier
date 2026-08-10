import { useQuery } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { Link } from "react-router-dom";

import { XtermTerminal } from "@/components/terminal/XtermTerminal";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type { ClaudeStatus } from "@/types/api";

import { TabShell } from "@/features/project-detail/TabShell";

export function TerminalTab({
  projectId,
  started,
  onStart,
  onEnd,
}: {
  projectId: number;
  started: boolean;
  onStart: () => void;
  onEnd: () => void;
}) {
  const { data: status } = useQuery({
    queryKey: qk.claudeStatus,
    queryFn: () => api.get<ClaudeStatus>("/provider/claude/status"),
  });
  const ready = Boolean(status?.version && status?.authed);

  return (
    <TabShell
      tab="terminal"
      actions={
        <>
          {status?.version ? (
            <StatusBadge variant="success" label={`CLI ${status.version}`} />
          ) : (
            <StatusBadge variant="failed" label="CLI not found" />
          )}
          {status?.authed ? (
            <StatusBadge variant="success" label="Signed in" />
          ) : (
            <StatusBadge variant="warning" label="Not signed in" />
          )}
          {!started ? (
            <Button size="sm" disabled={!ready} onClick={onStart}>
              <Play className="size-4" /> Start session
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-4">
        {!ready ? (
          <p className="text-sm text-muted-foreground">
            Set up the Claude CLI under{" "}
            <Link to={`/projects/${projectId}/provider`} className="text-primary hover:underline">
              Provider
            </Link>{" "}
            first.
          </p>
        ) : null}

        {started ? (
          <XtermTerminal
            wsPath={`/projects/${projectId}/terminal/ws`}
            sendBinary
            fitToContainer
            onClosed={onEnd}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            The session reads a generated CLAUDE.md and queries live data through a read-only
            database role. It stays alive while you switch tabs and ends when you leave the project.
          </p>
        )}
      </div>
    </TabShell>
  );
}
