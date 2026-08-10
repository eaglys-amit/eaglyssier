import type { Milestone, Roadmap, RoadmapSprintBand } from "@/types/api";

import { buildScale, type GanttScale } from "../gantt/scale";

/**
 * Pure geometry for the roadmap canvas — no React, no DOM, no colour.
 *
 * Same split as burndown.ts / velocity.ts / gantt/scale.ts: this file decides
 * where every mark goes, RoadmapChart.tsx decides what it looks like. It reuses
 * the Gantt's date scale rather than growing a second one, so the two timelines
 * in this project can never disagree about where a date sits.
 */

/** Nothing narrower than this is visible, so a one-day milestone still shows. */
const MIN_BAR = 8;

export interface MilestoneBar {
  milestone: Milestone;
  /** Left edge of the bar. */
  left: number;
  /** Full bar width, start → the later of target and forecast. */
  width: number;
  /** Completed portion, `width * progress`. */
  fillWidth: number;
  /** The target-date diamond. null when the milestone has no target. */
  targetX: number | null;
  /**
   * The forecast tail, drawn from targetX to forecastX. null unless the
   * forecast actually lands after the target — an on-time projection needs no
   * annotation, and drawing one would cry wolf.
   */
  forecast: { from: number; to: number } | null;
}

export interface SprintBand {
  sprint: RoadmapSprintBand;
  left: number;
  width: number;
}

export interface RoadmapGeometry {
  scale: GanttScale;
  bars: MilestoneBar[];
  bands: SprintBand[];
  /** x of the "today" rule. Always in range: the service pins it into the domain. */
  todayX: number;
}

/**
 * Lay out the roadmap. Returns null when there is nothing dated to plot, which
 * the view renders as an empty state rather than an axis with no marks.
 */
export function buildRoadmap(data: Roadmap): RoadmapGeometry | null {
  if (!data.range_start || !data.range_end) return null;
  const scale = buildScale(data.range_start, data.range_end);

  const bands: SprintBand[] = data.sprints.map((sprint) => {
    const left = scale.x(sprint.start_date);
    return {
      sprint,
      left,
      width: Math.max(MIN_BAR, scale.x(sprint.end_date) - left),
    };
  });

  const bars: MilestoneBar[] = data.milestones.map((milestone) => {
    const targetX = milestone.target_date ? scale.x(milestone.target_date) : null;
    const forecastX = milestone.forecast_date ? scale.x(milestone.forecast_date) : null;

    // An undated milestone still gets a row and a diamond-less bar stub at its
    // earliest known point, so it isn't silently dropped from the roadmap.
    const left = milestone.start_date ? scale.x(milestone.start_date) : (targetX ?? 0);
    const right = Math.max(targetX ?? left, forecastX ?? left, left + MIN_BAR);
    const width = Math.max(MIN_BAR, right - left);

    return {
      milestone,
      left,
      width,
      fillWidth: Math.max(0, Math.min(1, milestone.progress)) * width,
      targetX,
      // Only when it slips: days_late is null unless both dates exist.
      forecast:
        forecastX !== null && targetX !== null && (milestone.days_late ?? 0) > 0
          ? { from: targetX, to: forecastX }
          : null,
    };
  });

  return { scale, bars, bands, todayX: scale.x(new Date()) };
}
