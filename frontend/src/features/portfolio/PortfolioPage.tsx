import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, LayoutDashboard, TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";

import { BrandLink } from "@/components/layout/BrandLink";
import { PageHeader } from "@/components/layout/PageHeader";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { EmptyState } from "@/components/shared/EmptyState";
import { KpiStat } from "@/components/shared/KpiStat";
import { milestoneHealthBadge, StatusBadge } from "@/components/shared/StatusBadge";
import { TableSkeleton } from "@/components/shared/TableSkeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UserMenu } from "@/features/auth/UserMenu";
import { api } from "@/lib/api";
import { formatDate, formatDateTime, formatPoints } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/permissions";
import { qk } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import type { Portfolio, PortfolioHealth, PortfolioProject } from "@/types/api";

import { Sparkline } from "./Sparkline";

const HEALTH: Record<
  PortfolioHealth,
  { label: string; variant: "success" | "warning" | "failed" | "neutral"; order: number }
> = {
  red: { label: "Off track", variant: "failed", order: 0 },
  amber: { label: "Needs attention", variant: "warning", order: 1 },
  green: { label: "On track", variant: "success", order: 2 },
  unknown: { label: "No data", variant: "neutral", order: 3 },
};

// Show this many reasons inline; the rest collapse into a count.
const REASONS_SHOWN = 2;

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function HealthCell({ project }: { project: PortfolioProject }) {
  const h = HEALTH[project.health];
  const extra = project.health_reasons.length - REASONS_SHOWN;
  return (
    <div className="space-y-1">
      <StatusBadge variant={h.variant} label={h.label} />
      {project.health_reasons.length ? (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {project.health_reasons.slice(0, REASONS_SHOWN).map((r) => (
            <li key={r}>{r}</li>
          ))}
          {extra > 0 ? (
            <li title={project.health_reasons.slice(REASONS_SHOWN).join("\n")}>+{extra} more</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

function SprintCell({ project }: { project: PortfolioProject }) {
  const s = project.active_sprint;
  if (!s) return <span className="text-xs text-muted-foreground">No active sprint</span>;
  const scope = s.scope_change;
  return (
    <div className="min-w-40 space-y-1">
      <div className="truncate text-sm">{s.name}</div>
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: pct(s.progress) }} />
        </div>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {formatPoints(s.completed_points)}/{formatPoints(s.total_points)}
        </span>
      </div>
      {scope != null && scope !== 0 ? (
        <div
          className={cn(
            "text-xs",
            scope > 0.25 ? "text-destructive" : scope > 0.1 ? "text-warning" : "text-muted-foreground",
          )}
        >
          Scope {scope > 0 ? "+" : ""}
          {pct(scope)} since start
        </div>
      ) : null}
    </div>
  );
}

function VelocityCell({ project }: { project: PortfolioProject }) {
  const trend = project.velocity_trend;
  return (
    <div className="flex items-center gap-2">
      <Sparkline values={project.velocity_series.map((v) => v.completed_points)} />
      <div className="text-xs">
        <div className="font-mono tabular-nums">{formatPoints(project.velocity_rolling3)} pts</div>
        {trend != null ? (
          <div
            className={cn(
              "flex items-center gap-0.5",
              trend < 0.8 ? "text-warning" : "text-muted-foreground",
            )}
          >
            {trend >= 1 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
            {pct(trend)} of avg
          </div>
        ) : (
          <div className="text-muted-foreground">rolling 3</div>
        )}
      </div>
    </div>
  );
}

function MilestoneCell({ project }: { project: PortfolioProject }) {
  const m = project.next_milestone;
  if (!m) return <span className="text-xs text-muted-foreground">No open milestones</span>;
  return (
    <div className="min-w-44 space-y-1">
      <Link
        to={`/projects/${project.id}/milestones`}
        className="line-clamp-2 text-sm hover:text-primary hover:underline"
      >
        {m.name}
      </Link>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {milestoneHealthBadge(m.health)}
        <span>Target {m.target_date ? formatDate(m.target_date) : "—"}</span>
        {m.on_time_probability !== null ? (
          <span>· {Math.round(m.on_time_probability * 100)}% likely on time</span>
        ) : null}
      </div>
      <div className="text-xs text-muted-foreground">
        {m.forecast_date
          ? m.forecast_p85 && m.forecast_p85 !== m.forecast_date
            ? `Likely ${formatDate(m.forecast_date)} – ${formatDate(m.forecast_p85)}`
            : `Forecast ${formatDate(m.forecast_date)}`
          : null}
      </div>
    </div>
  );
}

function SyncCell({ project }: { project: PortfolioProject }) {
  return (
    <div className="text-xs">
      <div className="text-muted-foreground">
        {project.last_synced_at ? formatDateTime(project.last_synced_at) : "Never"}
      </div>
      {project.last_sync_failed ? (
        <div className="flex items-center gap-1 text-destructive">
          <TriangleAlert className="size-3" /> Last sync failed
        </div>
      ) : null}
    </div>
  );
}

/**
 * Every project the user can see, worst health first: the VP's weekly
 * landing page. Each number is the same one the project's own pages show
 * (velocity from Scrums, milestone health from Milestones), so a row is a
 * summary, never a second opinion.
 */
export function PortfolioPage() {
  const { data, isPending } = useQuery({
    queryKey: qk.portfolio,
    queryFn: () => api.get<Portfolio>("/portfolio"),
  });

  const projects = [...(data?.projects ?? [])].sort(
    (a, b) => HEALTH[a.health].order - HEALTH[b.health].order || a.name.localeCompare(b.name),
  );
  const count = (h: PortfolioHealth) => projects.filter((p) => p.health === h).length;
  const milestonesAt = (...hs: ("at_risk" | "off_track" | "overdue")[]) =>
    projects.reduce(
      (n, p) => n + hs.reduce((k, h) => k + (p.milestones_by_health[h] ?? 0), 0),
      0,
    );

  return (
    <>
      <PageHeader
        leading={<BrandLink />}
        title="Portfolio"
        description="Delivery health across your projects."
        actions={
          <>
            <UserMenu />
            <ThemeToggle />
          </>
        }
      />
      <div className="space-y-4 p-6">
        {isPending ? (
          <TableSkeleton />
        ) : !projects.length ? (
          <EmptyState
            icon={LayoutDashboard}
            title="No projects to show"
            hint="You'll see a project here once you're added to it."
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <KpiStat label="Off track" value={count("red")} />
              <KpiStat label="Needs attention" value={count("amber")} />
              <KpiStat label="On track" value={count("green")} />
              <KpiStat
                label="Milestones off track"
                value={milestonesAt("off_track", "overdue")}
              />
              <KpiStat label="Milestones at risk" value={milestonesAt("at_risk")} />
            </div>
            <Card>
              <CardContent className="overflow-x-auto p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Project</TableHead>
                      <TableHead className="w-64">Health</TableHead>
                      <TableHead>Active sprint</TableHead>
                      <TableHead>Velocity</TableHead>
                      <TableHead>Next milestone</TableHead>
                      <TableHead>Last sync</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {projects.map((p) => (
                      <TableRow key={p.id} className="align-top">
                        <TableCell>
                          <Link
                            to={`/projects/${p.id}`}
                            className="font-medium text-foreground hover:text-primary hover:underline"
                          >
                            {p.name}
                          </Link>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {p.key ? <Badge variant="secondary">{p.key}</Badge> : null}
                            {p.role ? (
                              <span className="text-xs text-muted-foreground">
                                {ROLE_LABELS[p.role]}
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <HealthCell project={p} />
                        </TableCell>
                        <TableCell>
                          <SprintCell project={p} />
                        </TableCell>
                        <TableCell>
                          <VelocityCell project={p} />
                        </TableCell>
                        <TableCell>
                          <MilestoneCell project={p} />
                        </TableCell>
                        <TableCell>
                          <SyncCell project={p} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            {data ? (
              <p className="text-xs text-muted-foreground">
                As of {formatDateTime(data.generated_at)}. Milestones are on track when at least
                70% of simulated futures make the target, at risk from 30%, off track below.
                Health turns amber for at-risk milestones, sprint scope growth over 10%, recent
                velocity below 80% of the average, or no sync for a week; red for off-track or
                overdue milestones, or scope growth over 25%.
              </p>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
