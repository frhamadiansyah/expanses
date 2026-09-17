import { formatMinor } from '@expanses/core';
import { useApp } from '../../app/context';
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

/** Days left in the month the page is showing, counted from today when today is in it. */
function daysLeft(month: string, today: string): number {
  const [year, index] = month.split('-').map(Number);
  const last = new Date(year!, index!, 0).getDate();
  if (today.slice(0, 7) !== month) return 0;
  return Math.max(0, last - Number(today.slice(8, 10)));
}

export interface GaugeWords {
  left: string;
  over: string;
  set: string;
  /** How many lines went over, said in the gauge's own terms. */
  overCount: (count: number) => string;
}

const MONTH_WORDS: GaugeWords = {
  left: 'Left to spend',
  over: 'Over budget by',
  set: 'Budgeted',
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
  month,
  today,
  words = MONTH_WORDS,
  last,
}: {
  progress: BudgetProgress;
  month: string;
  today: string;
  /** How the gauge talks: a month has budgets, an event has a plan. */
  words?: GaugeWords;
  /** The third figure under the arc. Left out, it is the days left in the month. */
  last?: { label: string; value: string };
}) {
  const { ws } = useApp();
  const size = 320;
  const height = 182;
  const centre = size / 2;
  const middle = 152;
  const radius = 112;
  const width = 12;
  // Nine o'clock, over the top, round to three: the arc opens downwards, where the figures sit.
  const from = -Math.PI / 2;
  const span = Math.PI;
  const used = progress.capsMinor > 0 ? Math.min(1, progress.spentMinor / progress.capsMinor) : 0;
  const left = progress.capsMinor - progress.spentMinor;
  // Red is for the month as a whole being over, not for one category: a single overspend is said in its own row.
  const tone = left < 0 ? '#b91c1c' : '#16a34a';
  const [knobX, knobY] = point(centre, middle, radius, from + used * span);
  const days = daysLeft(month, today);

  return (
    <div>
      <svg viewBox={`0 0 ${size} ${height}`} className="mx-auto block w-full max-w-[300px]" role="img" aria-label={`${formatMinor(Math.abs(left), ws.baseCurrency)} ${(left < 0 ? words.over : words.left).toLowerCase()}`}>
        <path d={arc(centre, middle, radius, from, from + span)} stroke="#e8ecf1" strokeWidth={width} strokeLinecap="round" fill="none" />
        <path d={arc(centre, middle, radius, from, from + Math.max(0.02, used * span))} stroke={tone} strokeWidth={width} strokeLinecap="round" fill="none" />
        <circle cx={knobX} cy={knobY} r={7.5} fill="#ffffff" stroke={tone} strokeWidth={4} />
        <text x={centre} y={middle - 44} textAnchor="middle" className="fill-slate-500 text-[11.5px]">
          {left < 0 ? words.over : words.left}
        </text>
        <text x={centre} y={middle - 16} textAnchor="middle" className="text-[25px] font-bold" fill={tone}>
          {formatMinor(Math.abs(left), ws.baseCurrency)}
        </text>
        {progress.overCount > 0 && (
          <text x={centre} y={middle} textAnchor="middle" className="text-[11px] font-semibold" fill="#b91c1c">
            {words.overCount(progress.overCount)}
          </text>
        )}
      </svg>
      <div className="flex text-center">
        {[
          [words.set, formatMinor(progress.capsMinor, ws.baseCurrency)],
          ['Spent', formatMinor(progress.spentMinor, ws.baseCurrency)],
          last ? [last.label, last.value] : ['Left in month', days === 1 ? '1 day' : `${days} days`],
        ].map(([label, value]) => (
          <div key={label} className="flex-1 px-1 not-first:border-l not-first:border-slate-200">
            <b className="tabular block text-[13.5px] font-semibold">{value}</b>
            <span className="text-[11px] text-slate-500">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
