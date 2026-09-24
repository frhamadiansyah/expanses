import { formatMinor } from '@expanses/core';
import { chartGeometry, shortMoney } from './value-chart';

/** Month-end values as a small area chart. Hand-drawn SVG: no chart library in this app. */
export function ValueChart({ values, labels, currency }: { values: number[]; labels: string[]; currency: string }) {
  if (values.length === 0) return null;
  const chart = chartGeometry(values, labels);
  return (
    <svg viewBox={`0 0 ${chart.width} ${chart.height}`} className="h-auto w-full" role="img" aria-label="Value over the last 12 months">
      {chart.ticks.map((tick) => (
        <g key={tick.value}>
          <line x1={74} x2={chart.width - 16} y1={tick.y} y2={tick.y} stroke="#e2e8f0" strokeWidth={1} fill="none" />
          <text x={66} y={tick.y + 4} textAnchor="end" fill="#64748b" fontSize={11}>
            {shortMoney(tick.value, currency)}
          </text>
        </g>
      ))}
      {chart.points.map((point) => (
        <text key={point.label + point.x} x={point.x} y={chart.height - 8} textAnchor="middle" fill="#64748b" fontSize={11}>
          {point.label}
        </text>
      ))}
      <path d={chart.area} fill="#047857" fillOpacity={0.12} stroke="none" />
      <polyline points={chart.line} fill="none" stroke="#047857" strokeWidth={2} />
      <circle cx={chart.last.x} cy={chart.last.y} r={4} fill="#047857" stroke="#ffffff" strokeWidth={2} />
      {chart.points.map((point) => (
        <title key={`t-${point.label}`}>{`${point.label}: ${formatMinor(point.value, currency)}`}</title>
      ))}
    </svg>
  );
}
