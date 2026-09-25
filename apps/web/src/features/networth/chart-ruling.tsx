import type { ChartTick } from './value-chart';

/**
 * The ruling a drawing is read against: a hairline a month, and a dotted one a gridline.
 *
 * A chart on white with a line floating in it reads as a line that could be anywhere; the ruling is what turns it into
 * a figure on a page. Nothing is written beside it — what a month is worth is asked for by tapping, and a row of axis
 * figures is exactly what this page threw away.
 *
 * The two directions are drawn differently on purpose: the months are the drawing's own beats and are solid, and the
 * amounts are a grid the eye may follow out from them and are dotted. Two sets of identical lines crossing would read
 * as a net rather than as a chart, and the reader would have to work out which is which.
 */
export function ChartRuling({
  guides,
  ticks,
  width,
  height,
  zeroY,
}: {
  /** The vertical hairlines, in the drawing's own coordinates: one a month, already thinned. */
  guides: readonly number[];
  /** The horizontal ones, one a gridline, at the values the scale worked out. */
  ticks: readonly ChartTick[];
  width: number;
  height: number;
  /** Where nothing is, drawn solid: the line the stacks stand on. Left off where the drawing has no such line. */
  zeroY?: number;
}) {
  return (
    <g aria-hidden>
      {ticks.map((tick) => (
        <line key={`h${tick.value}`} x1={0} x2={width} y1={tick.y} y2={tick.y} stroke="var(--ph-hair)" strokeWidth={1} strokeDasharray="1 4" />
      ))}
      {guides.map((at) => (
        <line key={`v${at}`} x1={at} x2={at} y1={0} y2={height} stroke="var(--ph-hair)" strokeWidth={1} />
      ))}
      {zeroY !== undefined && <line x1={0} x2={width} y1={zeroY} y2={zeroY} stroke="var(--ph-hair)" strokeWidth={1} />}
    </g>
  );
}
