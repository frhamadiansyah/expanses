import { formatMinor } from '@expanses/core';
import { useState } from 'react';
import { textWidth } from '../../ui/native';
import { type ChartPoint, nearestIndex } from './value-chart';

/** The room a reading needs around it, and how far off its month it sits. */
const PILL_PAD = 10;
const PILL_HEIGHT = 44;
const PILL_GAP = 10;

/**
 * The room a reading is written in, above the drawing.
 *
 * Both views leave exactly this strip empty at the top, because the reading is drawn over the month the finger is on
 * and the months nearest the top of the drawing are the ones whose figure most wants reading. It is the drawing's own
 * reservation, so it is exported rather than left as a number each view happens to use.
 */
export const READING_ROOM = PILL_HEIGHT + PILL_GAP;

/**
 * Reading a month off a drawing by touching it.
 *
 * The same in both views — a line and a stack are two ways of drawing one series, and which month a tap is asking about
 * has nothing to do with which shape is under it. A drawing is read rather than studied: a tap picks the month nearest
 * it, dragging moves the reading along, the arrows walk the months on a keyboard, and Escape lets go.
 *
 * A month with no figure is stepped over rather than answered with an empty reading — there is nothing to say about it.
 */
export function useChartReading(points: readonly (ChartPoint | null)[], width: number) {
  const [picked, setPicked] = useState<number | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const reading = picked === null ? null : (points[picked] ?? null);
  /** Where a pointer is, in the drawing's own coordinates. */
  const at = (clientX: number, box: DOMRect) => ((clientX - box.left) / box.width) * width;
  const pick = (event: React.PointerEvent<SVGSVGElement>) => setPicked(nearestIndex(points, at(event.clientX, event.currentTarget.getBoundingClientRect())));
  /** The months a key can walk to: a month with no figure has nothing to read, so it is stepped over. */
  const months = points.flatMap((point, index) => (point ? [index] : []));
  const step = (by: number) => {
    const from = months.indexOf(picked ?? months[0] ?? 0);
    const next = months[(from === -1 ? 0 : from + by + months.length) % months.length];
    if (next !== undefined) setPicked(next);
  };

  return {
    reading,
    /** Everything a drawing needs to be read: spread onto its own `<svg>`. */
    svgProps: {
      role: 'group' as const,
      tabIndex: 0,
      'aria-label': 'Net worth by month. Tap a month to read it, or use the arrow keys.',
      /*
       * No focus ring and no tap flash: the drawing is read by tapping it, and a blue border around the whole chart in
       * answer to a tap is the phone's guess at what a tap meant, not this app's. What a keyboard gets instead is the
       * reading itself, which is announced as it moves.
       */
      className: 'touch-pan-y select-none outline-none',
      style: { WebkitTapHighlightColor: 'transparent' } as React.CSSProperties,
      onPointerDown: (event: React.PointerEvent<SVGSVGElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        setScrubbing(true);
        pick(event);
      },
      onPointerMove: (event: React.PointerEvent<SVGSVGElement>) => scrubbing && pick(event),
      onPointerUp: () => setScrubbing(false),
      onPointerCancel: () => setScrubbing(false),
      onBlur: () => setScrubbing(false),
      onKeyDown: (event: React.KeyboardEvent<SVGSVGElement>) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault();
          step(event.key === 'ArrowRight' ? 1 : -1);
        } else if (event.key === 'Escape') {
          setPicked(null);
        }
      },
    },
  };
}

/**
 * One month's figure, over the point it belongs to.
 *
 * Anchored above its month, and below it where the drawing has no room above — the top of the line is exactly where a
 * reading is most wanted, so it cannot be the one place it is not drawn — and kept between the drawing's own edges for
 * the same reason.
 */
export function ChartReading({ point, currency, width }: { point: ChartPoint; currency: string; width: number }) {
  const money = formatMinor(point.value, currency);
  const box = Math.max(textWidth(money, 15), textWidth(point.label, 12.5)) + PILL_PAD * 2;
  const x = Math.min(Math.max(point.x - box / 2, 0), Math.max(0, width - box));
  const y = point.y - PILL_HEIGHT - PILL_GAP < 0 ? point.y + PILL_GAP : point.y - PILL_HEIGHT - PILL_GAP;
  return (
    <g data-testid="net-worth-reading">
      {/* A hairline down to the month it belongs to, so a reading in the middle of a year says which month it is. */}
      <line x1={point.x} x2={point.x} y1={Math.min(point.y, y)} y2={Math.max(point.y, y)} stroke="var(--ph-hair)" strokeWidth={1} />
      <circle cx={point.x} cy={point.y} r={4} fill={point.value < 0 ? 'var(--ph-alarm)' : 'var(--ph-tint)'} stroke="var(--ph-surface)" strokeWidth={2} />
      <rect x={x} y={y} width={box} height={PILL_HEIGHT} rx={9} fill="var(--ph-surface)" stroke="var(--ph-hair)" />
      <text x={x + box / 2} y={y + 18} textAnchor="middle" fontSize={12.5} fill="var(--ph-ink-3)">
        {point.label}
      </text>
      <text x={x + box / 2} y={y + 35} textAnchor="middle" fontSize={15} fontWeight={600} fill="var(--ph-ink)">
        {money}
      </text>
    </g>
  );
}

/** The same two things the reading draws, in the page as words and announced as they change. */
export function ChartAnnouncement({ point, currency }: { point: ChartPoint | null; currency: string }) {
  return (
    <p className="sr-only" aria-live="polite">
      {point ? `${point.label}: ${formatMinor(point.value, currency)}` : ''}
    </p>
  );
}
