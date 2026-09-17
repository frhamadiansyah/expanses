/** Where a point sits on a circle, measured clockwise from twelve. */
function point(cx: number, cy: number, r: number, angle: number): [number, number] {
  return [cx + r * Math.cos(angle - Math.PI / 2), cy + r * Math.sin(angle - Math.PI / 2)];
}

/** One ring of a donut: where a slice starts and stops on the circle. */
function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const [x1, y1] = point(cx, cy, r, from);
  const [x2, y2] = point(cx, cy, r, to);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > Math.PI ? 1 : 0} 1 ${x2} ${y2}`;
}

/** Below this share a slice is too thin to write against without the labels colliding. */
const LABEL_FLOOR = 7;

/**
 * How much of the circle each slice gets, so that every one is long enough to be drawn as a pill.
 *
 * A share too small for that is lifted to the shortest pill, and the angle it needs is taken from the others in
 * proportion to their size: the small slices stop being to scale, which the label and the rows below make good.
 */
export function pillSweeps(shares: readonly number[], round: number, least: number): number[] {
  const sum = shares.reduce((total, share) => total + share, 0);
  if (sum <= 0) return shares.map(() => 0);
  const lifted = new Set<number>();
  // Lifting one slice shrinks the rest, which can push another under the floor; settle until nothing moves.
  for (let pass = 0; pass <= shares.length; pass += 1) {
    const kept = shares.reduce((total, share, index) => total + (lifted.has(index) ? 0 : share), 0);
    const room = round - least * lifted.size;
    let moved = false;
    shares.forEach((share, index) => {
      if (!lifted.has(index) && kept > 0 && (share / kept) * room < least) {
        lifted.add(index);
        moved = true;
      }
    });
    if (!moved) break;
  }
  const kept = shares.reduce((total, share, index) => total + (lifted.has(index) ? 0 : share), 0);
  const room = Math.max(0, round - least * lifted.size);
  return shares.map((share, index) => (lifted.has(index) ? least : kept > 0 ? (share / kept) * room : 0));
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
  // The drawing is the ring plus what is written against it, so it is wider than it is tall: the names
  // need room at the sides, and cutting them to fit a square is what forces "Proper…" on a plain word.
  const size = 400;
  const height = 306;
  const centre = size / 2;
  const middleOf = height / 2;
  const radius = 88;
  const width = 24;
  /** Where the ring's outer edge is. Nothing written against it may start inside this. */
  const edge = radius + width / 2;
  // Every slice keeps the same air around it: the gap is taken out of the circle before the shares are
  // measured, and each arc is pulled in by its own round cap so a tiny slice cannot spill into its neighbour.
  const air = slices.length > 1 ? 7 / radius : 0;
  const cap = width / 2 / radius;
  const round = Math.PI * 2 - air * slices.length;
  const sweeps = pillSweeps(
    slices.map((slice) => (totalMinor > 0 ? slice.totalMinor / totalMinor : 0)),
    round,
    // The shortest a slice can be and still read as a pill: a little longer than the ring is thick.
    slices.length > 1 ? (width + 6) / radius : 0,
  );
  let at = 0;
  const drawn: { key: string; mid: number; share: number; label: string; colour: string }[] = [];

  return (
    <svg
      viewBox={`0 0 ${size} ${height}`}
      className="mx-auto block w-full"
      role="img"
      // Only what the middle says: the word "category" here would answer to a search for the field of that name.
      aria-label={`${middle} ${label}`}
    >
      {slices.map((slice, index) => {
        const sweep = sweeps[index] ?? 0;
        // A slice that takes the whole circle cannot be an arc: its ends meet, and an arc of zero shows nothing.
        const whole = sweep >= Math.PI * 2 - 0.001;
        const inset = Math.min(cap, sweep / 2);
        const from = at + air / 2 + inset;
        const d = whole
          ? `${arc(centre, middleOf, radius, 0, Math.PI)} ${arc(centre, middleOf, radius, Math.PI, Math.PI * 2)}`
          : arc(centre, middleOf, radius, from, Math.max(from, at + air / 2 + sweep - inset));
        drawn.push({
          key: slice.key,
          mid: at + air / 2 + sweep / 2,
          share: totalMinor > 0 ? Math.round((slice.totalMinor / totalMinor) * 100) : 0,
          label: slice.label,
          colour: slice.colour,
        });
        at += sweep + air;
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
      {/* The share and the name are written against the slice, on a leader that runs outwards from it. */}
      {drawn.map((slice) => {
        if (slice.share < LABEL_FLOOR) return null;
        const [lx, ly] = point(centre, middleOf, edge + 4, slice.mid);
        const [tx, ty] = point(centre, middleOf, edge + 24, slice.mid);
        const right = Math.cos(slice.mid - Math.PI / 2) >= 0;
        const x = right ? tx + 4 : tx - 4;
        // The words run outwards from the ring and never back towards it: a name too long for the room left
        // is cut to fit, because moving it inwards would put it over the chart.
        const space = right ? size - 3 - x : x - 3;
        const fits = Math.floor(space / 5.4);
        const name = slice.label.length <= fits ? slice.label : fits >= 5 ? `${slice.label.slice(0, fits - 1)}…` : '';
        return (
          <g key={`${slice.key}-label`}>
            <line x1={lx} y1={ly} x2={tx} y2={ty} stroke={slice.colour} strokeWidth={1.5} />
            <text x={x} y={ty + 3} textAnchor={right ? 'start' : 'end'} className="fill-slate-900 text-[10px] font-semibold">
              {slice.share}%
            </text>
            {name && (
              <text x={x} y={ty + 14} textAnchor={right ? 'start' : 'end'} className="fill-slate-500 text-[9.5px]">
                {name}
              </text>
            )}
          </g>
        );
      })}
      <text x={centre} y={middleOf - 12} textAnchor="middle" className="fill-slate-500 text-[10px]">
        {label}
      </text>
      <text x={centre} y={middleOf + 9} textAnchor="middle" className="fill-slate-900 text-[16px] font-bold">
        {middle}
      </text>
      {under && (
        <text x={centre} y={middleOf + 24} textAnchor="middle" className="fill-slate-500 text-[10px]">
          {under}
        </text>
      )}
    </svg>
  );
}
