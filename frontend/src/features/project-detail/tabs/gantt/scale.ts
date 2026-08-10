/**
 * A date→x pixel scale for the Gantt timeline, with month + day header ticks.
 *
 * Shared by two timelines: the Gantt and the Milestones roadmap. Keep it free
 * of anything specific to either, so a date always lands on the same x in both.
 */
export interface GanttScale {
  totalWidth: number;
  pxPerDay: number;
  x: (value: string | Date) => number;
  /** Date gridlines at an adaptive interval, labelled with the actual date. */
  days: { x: number; label: string }[];
  /** Month segments: x is the month's left edge (may be < 0 for the first). */
  months: { x: number; label: string }[];
  domainStart: Date;
  domainEnd: Date;
}

const DAY = 86_400_000;

function midnight(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function buildScale(startIso: string, endIso: string): GanttScale {
  const domainStart = midnight(new Date(startIso));
  domainStart.setDate(domainStart.getDate() - 1); // one day of padding on the left
  const domainEnd = midnight(new Date(endIso));
  domainEnd.setDate(domainEnd.getDate() + 2); // and a couple on the right

  const spanDays = Math.max(1, Math.round((domainEnd.getTime() - domainStart.getTime()) / DAY));
  const pxPerDay = spanDays <= 30 ? 32 : spanDays <= 120 ? 14 : spanDays <= 365 ? 7 : 3;
  const totalWidth = spanDays * pxPerDay;

  const x = (value: string | Date) => {
    const d = typeof value === "string" ? new Date(value) : value;
    return ((d.getTime() - domainStart.getTime()) / DAY) * pxPerDay;
  };

  // Date ticks at an adaptive interval (~70px apart), labelled with the real
  // date — daily when zoomed in, every few days on longer ranges.
  const stepDays = Math.max(1, Math.ceil(70 / pxPerDay));
  const days: { x: number; label: string }[] = [];
  for (let i = 0; i <= spanDays; i += stepDays) {
    const d = new Date(domainStart.getTime() + i * DAY);
    days.push({
      x: i * pxPerDay,
      label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    });
  }

  // Months: one entry per calendar month touching the domain.
  const months: { x: number; label: string }[] = [];
  const m = new Date(domainStart.getFullYear(), domainStart.getMonth(), 1);
  while (m <= domainEnd) {
    months.push({ x: x(m), label: m.toLocaleDateString(undefined, { month: "short", year: "2-digit" }) });
    m.setMonth(m.getMonth() + 1);
  }

  return { totalWidth, pxPerDay, x, days, months, domainStart, domainEnd };
}
