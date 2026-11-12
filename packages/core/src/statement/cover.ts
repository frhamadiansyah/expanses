/**
 * Which of a card statement's purchases its lump payments have paid for. Nothing is stored: a payment made from the
 * card page (or any credit that is not a purchase paid one by one) covers the statement's purchases oldest first, so
 * deleting that payment makes them owed again on its own.
 */

/** Something the statement charged, in the order the statement lists it. */
export interface CoverCharge {
  key: string;
  /** The date that orders it: the oldest is covered first. */
  on: string;
  amountMinor: number;
  /** Paid one by one (or otherwise settled on its own): skipped, and never takes from the pool. */
  settled: boolean;
}

/** A credit whose money may be in the pool: a payment or money back, oldest first. */
export interface CoverCredit {
  key: string;
  on: string;
  /** A positive amount. */
  amountMinor: number;
}

export interface ChargeCover {
  coveredMinor: number;
  leftMinor: number;
  /** Covered to the last rupiah. */
  whole: boolean;
  /**
   * The credit that supplied the last of its cover: for a purchase covered whole, the payment that completed it. Null
   * when nothing covers it, or when that part of the pool is not one of the credits given (credit carried from before).
   */
  credit: CoverCredit | null;
}

const byDate = <T extends { on: string }>(items: readonly T[]) => [...items].sort((a, b) => a.on.localeCompare(b.on));

/**
 * Spreads `poolMinor` over the unsettled charges, oldest first (by date; same-day charges in the order given), and says
 * how much of each is covered and by which credit.
 *
 * The pool is worked out by the caller from the figures the statement already shows as paid. The credits only name
 * where its money came from: a bank clears the oldest balance first, so the earliest credits went to the older bill and
 * the pool is made of the latest ones. Where the credits listed add up to less than the pool, the difference is the
 * oldest part of it, and names no credit.
 *
 * Settled charges are left out of the result.
 */
export function coverOldestFirst(input: { charges: readonly CoverCharge[]; poolMinor: number; credits: readonly CoverCredit[] }): Map<string, ChargeCover> {
  const charges = byDate(input.charges).filter((charge) => !charge.settled);
  const total = charges.reduce((sum, charge) => sum + Math.max(0, charge.amountMinor), 0);
  // Never spread more than the purchases add up to, nor less than nothing.
  let pool = Math.min(Math.max(0, input.poolMinor), total);

  // The pool's sources, oldest first: the latest credits, back to where the pool is used up.
  const sources: { credit: CoverCredit | null; minor: number }[] = [];
  let needed = pool;
  for (const credit of byDate(input.credits).reverse()) {
    if (needed <= 0) break;
    const minor = Math.min(Math.max(0, credit.amountMinor), needed);
    if (minor > 0) sources.unshift({ credit, minor });
    needed -= minor;
  }
  if (needed > 0) sources.unshift({ credit: null, minor: needed });

  const out = new Map<string, ChargeCover>();
  let source = 0;
  for (const charge of charges) {
    const amount = Math.max(0, charge.amountMinor);
    let covered = 0;
    let last: CoverCredit | null = null;
    while (covered < amount && pool > 0 && source < sources.length) {
      const from = sources[source]!;
      const take = Math.min(from.minor, amount - covered);
      covered += take;
      from.minor -= take;
      pool -= take;
      last = from.credit;
      if (from.minor === 0) source += 1;
    }
    out.set(charge.key, { coveredMinor: covered, leftMinor: amount - covered, whole: amount > 0 && covered === amount, credit: covered > 0 ? last : null });
  }
  return out;
}
