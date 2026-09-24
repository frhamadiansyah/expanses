/**
 * The tile's balance, day by day, walked backwards from today.
 *
 * The figure the tile shows is what is true *now* — money you can move, less what goals claim, less what the debts
 * ask — and of those three only the money has a history the ledger can read. So the line is that figure, stepped
 * back through what actually moved: `flows` is each day's net movement in the money accounts, positive when money
 * arrived, in the base currency the ledger already converted it into. The goals and the debts are held at today's
 * figures for every day, which is what makes the line end exactly on the number above it.
 */

export interface DayBalance {
  /** YYYY-MM-DD. */
  on: string;
  minor: number;
}

/** The day before an ISO day. UTC arithmetic, so a timezone can never move a day. */
export function dayBefore(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** `days` before an ISO day: the start of the window a line of `days + 1` balances is read over. */
export function daysBefore(iso: string, days: number): string {
  let on = iso;
  for (let step = 0; step < days; step += 1) on = dayBefore(on);
  return on;
}

/**
 * `days + 1` balances ending today, oldest first.
 *
 * A day nothing moved on keeps the balance it started with, because the line is a balance and not a flow: a flat
 * stretch says "nothing happened", which is exactly what a reader wants from it.
 */
export function balanceSeries({
  todayMinor,
  today,
  days,
  flows,
}: {
  todayMinor: number;
  today: string;
  days: number;
  flows: readonly { on: string; minor: number }[];
}): DayBalance[] {
  const moved = new Map<string, number>();
  for (const flow of flows) moved.set(flow.on, (moved.get(flow.on) ?? 0) + flow.minor);
  const out: DayBalance[] = [];
  let minor = todayMinor;
  let on = today;
  for (let step = 0; step <= days; step += 1) {
    out.push({ on, minor });
    // Yesterday held today's balance less whatever moved today.
    minor -= moved.get(on) ?? 0;
    on = dayBefore(on);
  }
  return out.reverse();
}

export interface BalanceCrossing {
  /** The first day the balance was below nothing. */
  on: string;
  /** How far through the day *before* it the line crossed: 0 at that day's start, 1 at its end. */
  through: number;
}

/**
 * The day a run of balances went below nothing, if it did.
 *
 * The crossing is a moment between two days, not a day: the dot is drawn between the two readings, which is why it
 * carries a date rather than sitting on a gridline. Only the first crossing is answered — a line that goes below,
 * comes back and goes below again has one story to tell, and it is when it first went under.
 */
export function crossing(series: readonly DayBalance[]): BalanceCrossing | null {
  for (let index = 1; index < series.length; index += 1) {
    const before = series[index - 1]!.minor;
    const at = series[index]!.minor;
    if (before >= 0 && at < 0) return { on: series[index]!.on, through: before === at ? 0 : before / (before - at) };
  }
  return null;
}
