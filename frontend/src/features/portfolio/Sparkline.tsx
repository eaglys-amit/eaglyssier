/**
 * A tiny trend line of completed points per closed sprint. Decorative next to
 * the numbers it sits beside, which carry the same information as text — so it
 * is aria-hidden rather than a chart that needs a table twin.
 */
export function Sparkline({
  values,
  width = 72,
  height = 20,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  if (values.length < 2) {
    return <span className="inline-block text-xs text-muted-foreground">—</span>;
  }
  const max = Math.max(...values, 1);
  const pad = 2;
  const step = (width - pad * 2) / (values.length - 1);
  const y = (v: number) => height - pad - (v / max) * (height - pad * 2);
  const points = values.map((v, i) => `${pad + i * step},${y(v)}`).join(" ");
  const last = values[values.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        className="stroke-primary"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={pad + (values.length - 1) * step} cy={y(last)} r={2} className="fill-primary" />
    </svg>
  );
}
