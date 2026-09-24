/**
 * The ring the Accounts tile divides its money into: what is free to spend, and what the debts ask.
 *
 * Drawn rather than charted: it is one thin ring with two shares and a legend that is the two rows beneath it, and
 * the picture answers "of what" where the figure beside it answers "how much" — which is how iOS draws a metric,
 * and why the ring carries no labels of its own. Strokes on a circle rather than arcs: a share is a dash length,
 * and the gap between two shares is what is left of the circle.
 */

import { cx } from '../../ui';

export interface RingSegment {
  key: string;
  /** What this share is, as a screen reader hears it — the rows beside the ring say it to an eye. */
  label: string;
  minor: number;
  /** The same colour the row's own dot wears, so the ring and the rows are one legend. */
  colour: string;
}

/**
 * Each segment's share of the circle, in order.
 *
 * The gaps are taken out of the circle *before* the shares are measured, so the ring always closes and no share is
 * drawn longer than its own proportion. A share of nothing gets nothing: a rupiah of a million would be a sliver no
 * eye can find, and the row beside it already says the figure.
 */
export function ringSweeps(minors: readonly number[], gap = 0.04): number[] {
  const live = minors.filter((minor) => minor > 0).length;
  const total = minors.reduce((sum, minor) => sum + Math.max(0, minor), 0);
  if (total <= 0 || live === 0) return minors.map(() => 0);
  const room = Math.max(0, 1 - gap * live);
  return minors.map((minor) => (minor > 0 ? (minor / total) * room : 0));
}

export function SpendRing({
  segments,
  size = 92,
  thickness = 12,
  className,
}: {
  segments: readonly RingSegment[];
  size?: number;
  thickness?: number;
  className?: string;
}) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const sweeps = ringSweeps(segments.map((segment) => segment.minor));
  let drawn = 0;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={segments.map((segment) => segment.label).join(', ')}
      className={cx('shrink-0', className)}
    >
      {/* The track, so a ring of one share still reads as a ring rather than as a circle that missed a piece. */}
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--ph-track)" strokeWidth={thickness} />
      {segments.map((segment, index) => {
        const sweep = sweeps[index] ?? 0;
        const arc = sweep * circumference;
        const offset = -drawn * circumference;
        drawn += sweep;
        if (arc <= 0) return null;
        return (
          <circle
            key={segment.key}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={segment.colour}
            strokeWidth={thickness}
            // Rounded ends, as iOS draws a ring: the share reads as a pill of colour rather than as a wedge.
            strokeLinecap="round"
            strokeDasharray={`${arc} ${circumference - arc}`}
            strokeDashoffset={offset}
            // Twelve o'clock is where a share starts, as a clock face does.
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        );
      })}
    </svg>
  );
}
