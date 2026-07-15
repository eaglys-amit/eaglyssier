import { useQuery } from "@tanstack/react-query";
import { Play, TerminalSquare } from "lucide-react";
import { Link } from "react-router-dom";

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
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type { ClaudeStatus } from "@/types/api";

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
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TerminalSquare className="size-4" /> Project terminal
          </CardTitle>
          <CardDescription>
            An interactive Claude session scoped to this project: it reads a generated CLAUDE.md and
            queries live data through a read-only database role. The session stays alive while you
            switch tabs and ends when you leave the project.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
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
          </div>
          {!ready ? (
            <p className="text-xs text-muted-foreground">
              Set up the Claude CLI on the{" "}
              <Link to={`/projects/${projectId}/provider`} className="text-primary hover:underline">
                Provider tab
              </Link>{" "}
              first.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {started ? (
        <XtermTerminal
          wsPath={`/projects/${projectId}/terminal/ws`}
          sendBinary
          fitToContainer
          onClosed={onEnd}
        />
      ) : null}
    </div>
  );
}
