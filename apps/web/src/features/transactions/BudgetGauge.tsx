import { daysFrom, formatMinor, monthPeriod } from '@expanses/core';
import type { BudgetProgress } from './budget-progress';

/** Where a point sits on a circle, measured clockwise from twelve. */
function point(cx: number, cy: number, r: number, angle: number): [number, number] {
  return [cx + r * Math.cos(angle - Math.PI / 2), cy + r * Math.sin(angle - Math.PI / 2)];
}

function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const [x1, y1] = point(cx, cy, r, from);
  const [x2, y2] = point(cx, cy, r, to);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > Math.PI ? 1 : 0} 1 ${x2} ${y2}`;
}

/** Days left in the month the page is showing, after today, when today is in it: the workspace's month ("Month starts on"). */
function daysLeft(month: string, today: string, monthStart = 1): number {
  const { from, to } = monthPeriod(month, monthStart);
  if (today < from || today > to) return 0;
  return Math.max(0, daysFrom(today, to));
}

export interface GaugeWords {
  left: string;
  over: string;
  set: string;
  /** The middle figure's name. Spending under a cap is not always all the spending there is, and then it must say so. */
  spent: string;
  /** How many lines went over, said in the gauge's own terms. */
  overCount: (count: number) => string;
}

const MONTH_WORDS: GaugeWords = {
  left: 'Left to spend',
  over: 'Over budget by',
  set: 'Budgeted',
  spent: 'Spent',
  overCount: (count) => `${count} ${count === 1 ? 'budget' : 'budgets'} over`,
};

/**
 * The month against everything budgeted: the whole arc is what was set aside, the coloured part is what
 * is gone, and the figure in the bow of it is what is left.
 *
 * Spending with no budget over it is deliberately outside this: it cannot be measured against a cap that
 * does not exist, and rolling it in would make the arc say something no one set.
 */
export function BudgetGauge({
  progress,
  currency,
  month,
  today,
  words = MONTH_WORDS,
  last,
  monthStart = 1,
  plain = false,
}: {
  progress: BudgetProgress;
  /** The money the figures are in: the workspace's own on a month, the owner's on an event. */
  currency: string;
  month: string;
  today: string;
  /** How the gauge talks: a month has budgets, an event has a plan. */
  words?: GaugeWords;
  /** The third figure under the arc. Left out, it is the days left in the month. */
  last?: { label: string; value: string };
  /** The day the workspace's months start on; the days left count to that month's last day. */
  monthStart?: number;
  /**
   * The arc alone, in the app's colour tokens (light and dark): no figures under it, the page saying them beside it —
   * the wide screen's Budget box (Mac Budget). Left out, the gauge is the phone's, exactly as it was.
   */
  plain?: boolean;
}) {
  const size = 320;
  const height = 182;
  const centre = size / 2;
  const middle = 152;
  const radius = 112;
  const width = plain ? 16 : 12;
  // Nine o'clock, over the top, round to three: the arc opens downwards, where the figures sit.
  const from = -Math.PI / 2;
  const span = Math.PI;
  const used = progress.capsMinor > 0 ? Math.min(1, progress.spentMinor / progress.capsMinor) : 0;
  const left = progress.capsMinor - progress.spentMinor;
  // Red is for the month as a whole being over, not for one category: a single overspend is said in its own row.
  const tone = plain ? (left < 0 ? 'var(--ph-alarm)' : 'var(--ph-up)') : left < 0 ? '#b91c1c' : '#16a34a';
  const [knobX, knobY] = point(centre, middle, radius, from + used * span);
  const days = daysLeft(month, today, monthStart);

  return (
    <div>
      {/* Plain, the box is cropped to the arc itself, so the arc fills the width it is given. */}
      <svg viewBox={plain ? `${centre - radius - width} ${middle - radius - width} ${2 * (radius + width)} ${radius + 2 * width}` : `0 0 ${size} ${height}`} className={plain ? 'block w-full' : 'mx-auto block w-full max-w-[300px]'} role="img" aria-label={`${formatMinor(Math.abs(left), currency)} ${(left < 0 ? words.over : words.left).toLowerCase()}`}>
        <path d={arc(centre, middle, radius, from, from + span)} stroke={plain ? 'var(--ph-track)' : '#e8ecf1'} strokeWidth={width} strokeLinecap="round" fill="none" />
        <path d={arc(centre, middle, radius, from, from + Math.max(0.02, used * span))} stroke={tone} strokeWidth={width} strokeLinecap="round" fill="none" />
        {!plain && <circle cx={knobX} cy={knobY} r={7.5} fill={plain ? 'var(--ph-surface)' : '#ffffff'} stroke={tone} strokeWidth={4} />}
        <text x={centre} y={plain ? middle - 36 : middle - 44} textAnchor="middle" className={plain ? 'fill-[var(--ph-ink-3)] text-[13.5px]' : 'fill-slate-500 text-[11.5px]'}>
          {left < 0 ? words.over : words.left}
        </text>
        <text x={centre} y={plain ? middle - 6 : middle - 16} textAnchor="middle" className={plain ? 'text-[24px] font-semibold' : 'text-[25px] font-bold'} fill={plain && left >= 0 ? 'var(--ph-ink)' : tone}>
          {formatMinor(Math.abs(left), currency)}
        </text>
        {!plain && progress.overCount > 0 && (
          <text x={centre} y={middle} textAnchor="middle" className="text-[11px] font-semibold" fill="#b91c1c">
            {words.overCount(progress.overCount)}
          </text>
        )}
      </svg>
      {!plain && (
      <div className="flex text-center">
        {[
          [words.set, formatMinor(progress.capsMinor, currency)],
          [words.spent, formatMinor(progress.spentMinor, currency)],
          last ? [last.label, last.value] : ['Left in month', days === 1 ? '1 day' : `${days} days`],
        ].map(([label, value]) => (
          <div key={label} className="flex-1 px-1 not-first:border-l not-first:border-slate-200">
            <b className="tabular block text-[13.5px] font-semibold">{value}</b>
            <span className="text-[11px] text-slate-500">{label}</span>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}
