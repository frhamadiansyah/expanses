/**
 * A colour per category, and shades of it for the categories under it.
 *
 * The colour is worked out from the category's id rather than stored, so a category is the same colour
 * every month without anyone having to choose one. Picking them by hand can come later; this only has
 * to be stable and distinguishable.
 */

/** Eight hues that stay apart from each other, and read on white. */
const WHEEL = ['#1d4ed8', '#0d9488', '#f59e0b', '#db2777', '#7c3aed', '#0ea5e9', '#16a34a', '#b45309'] as const;

/** Anything too small to earn a slice of its own. */
export const OTHER_COLOUR = '#94a3b8';

function hash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

export function categoryColour(id: string): string {
  return WHEEL[hash(id) % WHEEL.length]!;
}

/** Colours picked by hand for top-level categories, by id (`listCategoryColours`). */
export type ChosenColours = Readonly<Record<string, string>>;

/**
 * The one rule every screen draws a category's colour by: a colour picked for its top-level category wins, and
 * without one the colour the screen works out for itself stands — the base colour on a mark, the wheel's on a chart.
 * `topId` is the top-level category's id; a subcategory is drawn in shades of whatever this answers for its parent.
 */
export function tintOf(topId: string | null | undefined, chosen: ChosenColours | undefined, automatic: string): string {
  return (topId && chosen?.[topId]) || automatic;
}

/** A top-level category's colour on a chart: the one picked for it, else the wheel's. */
export const chartColour = (id: string, chosen?: ChosenColours): string => tintOf(id, chosen, categoryColour(id));

/**
 * The same colour, lightened, for a child of that category: its children read as one family rather
 * than as eight unrelated things. `step` runs 0 for the largest child upwards.
 */
export function shade(colour: string, step: number, of: number): string {
  const t = of <= 1 ? 0 : (step / (of - 1)) * 0.62;
  const n = Number.parseInt(colour.slice(1), 16);
  const lift = (channel: number) => Math.round(channel + (255 - channel) * t);
  return `rgb(${lift((n >> 16) & 255)} ${lift((n >> 8) & 255)} ${lift(n & 255)})`;
}

export interface Slice<T> {
  item: T;
  totalMinor: number;
  colour: string;
}

/**
 * The slices a ring should show: the big ones as themselves, the tail gathered into one.
 *
 * Past eight or nine slices a donut becomes slivers nobody can tell apart or tap, so everything below
 * a fortieth of the total joins an "Other" slice — which still opens, like any other.
 */
export function ringSlices<T extends { id: string; totalMinor: number }>(
  items: readonly T[],
  limit = 8,
  chosen?: ChosenColours,
): { shown: Slice<T>[]; rest: T[] } {
  const sorted = [...items].filter((item) => item.totalMinor > 0).sort((a, b) => b.totalMinor - a.totalMinor);
  const total = sorted.reduce((sum, item) => sum + item.totalMinor, 0);
  const big = sorted.filter((item, index) => index < limit && item.totalMinor / total >= 0.025);
  const rest = sorted.slice(big.length);
  // A category keeps a colour picked for it. Any other keeps the colour its id gives it, unless a picked one or a
  // bigger one in this ring already has it.
  const taken = new Set<string>(big.map((item) => chosen?.[item.id]).filter((colour): colour is string => Boolean(colour)));
  const shown = big.map((item) => {
    const picked = chosen?.[item.id];
    if (picked) return { item, totalMinor: item.totalMinor, colour: picked };
    let colour = categoryColour(item.id);
    for (let step = 1; taken.has(colour) && step < WHEEL.length; step += 1) {
      colour = WHEEL[(WHEEL.indexOf(colour as (typeof WHEEL)[number]) + step) % WHEEL.length]!;
    }
    taken.add(colour);
    return { item, totalMinor: item.totalMinor, colour };
  });
  return { shown, rest };
}
