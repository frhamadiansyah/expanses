/** One ring of a donut: where a slice starts and stops on the circle. */
function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const at = (angle: number) => [cx + r * Math.cos(angle - Math.PI / 2), cy + r * Math.sin(angle - Math.PI / 2)];
  const [x1, y1] = at(from);
  const [x2, y2] = at(to);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > Math.PI ? 1 : 0} 1 ${x2} ${y2}`;
}

export interface DonutSlice {
  key: string;
  label: string;
  totalMinor: number;
  colour: string;
}

/**
 * A month's spending as a ring: each category's share of the whole, with the figure that matters
 * in the middle.
 *
 * The ring is the share and the middle is the amount, because a picture of proportions cannot answer
 * "how much" and a number cannot answer "of what".
 */
export function Donut({
  slices,
  totalMinor,
  middle,
  label,
  under,
  onPick,
}: {
  slices: readonly DonutSlice[];
  totalMinor: number;
  /** The amount in the middle, already formatted. */
  middle: string;
  /** What that amount is, above it. */
  label: string;
  /** A quieter line under it, usually how many transactions made it up. */
  under?: string;
  onPick?: (key: string) => void;
}) {
  const size = 216;
  const centre = size / 2;
  const radius = 84;
  const width = 26;
  // A hair of a gap between slices, so two neighbours of similar colour are still two things.
  const gap = slices.length > 1 ? 0.035 : 0;
  let at = 0;

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="mx-auto block h-52 w-52"
      role="img"
      // Only what the middle says: the word "category" here would answer to a search for the field of that name.
      aria-label={`${middle} ${label}`}
    >
      <circle cx={centre} cy={centre} r={radius} stroke="#eef2f7" strokeWidth={width} fill="none" />
      {slices.map((slice) => {
        const sweep = totalMinor > 0 ? (slice.totalMinor / totalMinor) * Math.PI * 2 : 0;
        // A slice that takes the whole circle cannot be an arc: its ends meet, and an arc of zero shows nothing.
        const whole = sweep >= Math.PI * 2 - 0.001;
        const d = whole
          ? `${arc(centre, centre, radius, 0, Math.PI)} ${arc(centre, centre, radius, Math.PI, Math.PI * 2)}`
          : arc(centre, centre, radius, at + gap / 2, Math.max(at + gap / 2, at + sweep - gap / 2));
        at += sweep;
        return (
          <path
            key={slice.key}
            d={d}
            stroke={slice.colour}
            strokeWidth={width}
            strokeLinecap="round"
            fill="none"
            className={onPick ? 'cursor-pointer' : undefined}
            onClick={onPick ? () => onPick(slice.key) : undefined}
          >
            <title>{slice.label}</title>
          </path>
        );
      })}
      <text x={centre} y={centre - 14} textAnchor="middle" className="fill-slate-500 text-[11px]">
        {label}
      </text>
      <text x={centre} y={centre + 9} textAnchor="middle" className="fill-slate-900 text-[19px] font-bold">
        {middle}
      </text>
      {under && (
        <text x={centre} y={centre + 27} textAnchor="middle" className="fill-slate-500 text-[11px]">
          {under}
        </text>
      )}
    </svg>
  );
}
