import { formatDate } from "@/lib/format";
import type { Milestone } from "@/types/api";

/** "68%" — the share of simulated futures that make the target date. */
export function formatChance(p: number | null): string | null {
  return p === null ? null : `${Math.round(p * 100)}%`;
}

/** "P50 5 Dec · P85 19 Dec", or the single date when there's no spread. */
export function forecastRange(m: Milestone): string | null {
  if (!m.forecast_p50) return null;
  if (!m.forecast_p85 || m.forecast_p85 === m.forecast_p50) return formatDate(m.forecast_p50);
  return `P50 ${formatDate(m.forecast_p50)} · P85 ${formatDate(m.forecast_p85)}`;
}

/** One sentence for tooltips and the detail sheet. */
export function forecastSentence(m: Milestone): string | null {
  const range = forecastRange(m);
  if (!range) return null;
  const chance = formatChance(m.on_time_probability);
  const lead = chance && m.target_date ? `${chance} likely by ${formatDate(m.target_date)} · ` : "";
  const caveat = m.confidence === "low" ? " (low confidence: under 3 closed sprints)" : "";
  return `${lead}${m.confidence === "low" ? "Forecast " : ""}${range}${caveat}`;
}
