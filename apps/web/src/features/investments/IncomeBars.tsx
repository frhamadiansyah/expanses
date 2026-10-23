import type { DividendMonth } from '@expanses/core';

/** The drawing's box: the Cashflow trend's width, at well under half its height — twelve bars with nothing on them need no more. */
const WIDTH = 400;
const HEIGHT = 112;
const TICK_ROOM = 22;
/** Air over the tallest bar, so it never runs into the caption above it. */
const TOP = 8;
/** The still-to-come shade: the tint, faint, as Cashflow draws the period still under way. */
const TO_COME_OPACITY = 0.25;

const initialOf = (month: number) => new Intl.DateTimeFormat('en', { month: 'narrow', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, month - 1, 1)));

/**
 * This year's twelve months under the hero's figure, drawn as Cashflow draws its trend: a rounded bar per month on a
 * hairline, the month's initial under it, and nothing written on the bars.
 *
 * What a month has paid is the tint; what it still owes from last year's pattern is the tint faint, drawn as the whole
 * bar with the paid part over it, so a month that paid one stock and still owes another reads as one bar in two shades
 * rather than two bars pinched at the join. A month with nothing is the hairline alone. Twelve figures over twelve bars
 * would be none of them legible, so the drawing is one button that opens Month by month, where each is named with its
 * payers and its figure.
 */
export function IncomeBars({ months, onOpen }: { months: readonly DividendMonth[]; onOpen: () => void }) {
  const base = HEIGHT - TICK_ROOM;
  const step = WIDTH / 12;
  const gap = step * 0.28;
  const width = step - gap;
  const rx = Math.min(4, width / 3);
  const peak = Math.max(0, ...months.map((m) => m.paidMinor + m.toComeMinor));
  const height = (minor: number) => (peak > 0 ? Math.max(minor > 0 ? 2 : 0, (minor / peak) * (base - TOP)) : 0);

  return (
    <button type="button" aria-label="Month by month" data-testid="income-months" onClick={onOpen} className="ph-focus-inset ph-tap block w-full">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block h-auto w-full" aria-hidden>
        {months.map((m, index) => {
          const x = index * step + gap / 2;
          const whole = height(m.paidMinor + m.toComeMinor);
          const paid = height(m.paidMinor);
          return (
            <g key={m.month}>
              {m.toComeMinor > 0 && <rect data-testid="income-month-due" x={x} y={base - whole} width={width} height={whole} rx={rx} fill="var(--ph-tint)" fillOpacity={TO_COME_OPACITY} />}
              {m.paidMinor > 0 && <rect data-testid="income-month-paid" x={x} y={base - paid} width={width} height={paid} rx={rx} fill="var(--ph-tint)" />}
            </g>
          );
        })}
        <line x1={0} x2={WIDTH} y1={base} y2={base} stroke="var(--ph-hair)" strokeWidth={1} />
        {months.map((m, index) => (
          <text key={m.month} x={index * step + step / 2} y={HEIGHT - 6} textAnchor="middle" fontSize={12} fill="var(--ph-ink-3)">
            {initialOf(m.month)}
          </text>
        ))}
      </svg>
    </button>
  );
}
