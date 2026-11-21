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
  /** How many of the credits given went into its cover: more than one, and no single payment paid for it. */
  credits: number;
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
    const from = new Set<string>();
    while (covered < amount && pool > 0 && source < sources.length) {
      const at = sources[source]!;
      const take = Math.min(at.minor, amount - covered);
      covered += take;
      at.minor -= take;
      pool -= take;
      last = at.credit;
      if (at.credit && take > 0) from.add(at.credit.key);
      if (at.minor === 0) source += 1;
    }
    out.set(charge.key, { coveredMinor: covered, leftMinor: amount - covered, whole: amount > 0 && covered === amount, credit: covered > 0 ? last : null, credits: from.size });
  }
  return out;
}

/**
 * One line of a card's whole history as the cover pool counts it, in the statement's order. `poolMinor` is what it adds
 * to the pool's figures: a charge positive, a credit negative, and nothing for what is settled on its own — a purchase
 * paid one by one and the part of its payment that paid it, a purchase or refund marked paid off before the app and its
 * balancing settlement. The caller decides that; this only adds up.
 */
export interface PoolLine {
  key: string;
  statementOn: string;
  poolMinor: number;
}

/**
 * Which of one statement's charges the card's credits cover, oldest first. The figures are the totals band's, worked
 * out over the pool lines alone: a bank clears the oldest balance first, so credits go to what was owed before the
 * statement (on an open one, the previous bill), and only what is over reaches its charges. A closed statement counts
 * the credits since its statement date, up to today; an open one, those in its cycle. A credit carried on the card from
 * before covers a closed statement's charges too, naming no credit; an open statement leaves it be, as the band does.
 */
export function coverStatement(input: { lines: readonly PoolLine[]; cycle: { start: string; end: string }; today: string }): Map<string, ChargeCover> {
  const { start, end } = input.cycle;
  const sum = (lines: readonly PoolLine[]) => lines.reduce((total, line) => total + line.poolMinor, 0);
  const closed = end < input.today;
  const inCycle = input.lines.filter((line) => line.statementOn >= start && line.statementOn <= end);
  const openingMinor = sum(input.lines.filter((line) => line.statementOn < start));
  const charges = inCycle.filter((line) => line.poolMinor > 0);
  const chargedMinor = sum(charges);
  const cycleCredits = inCycle.filter((line) => line.poolMinor < 0);
  const creditedMinor = -sum(cycleCredits);
  const later = closed ? input.lines.filter((line) => line.poolMinor < 0 && line.statementOn > end && line.statementOn <= input.today) : [];

  let owedMinor: number;
  if (closed) {
    const billMinor = Math.max(0, openingMinor + chargedMinor - creditedMinor);
    owedMinor = billMinor - Math.min(-sum(later), billMinor);
  } else {
    const previousMinor = Math.max(0, openingMinor);
    const spilledMinor = Math.min(creditedMinor - Math.min(creditedMinor, previousMinor), chargedMinor);
    owedMinor = chargedMinor - spilledMinor;
  }
  // What is still owed sits on the newest charges; the rest is covered.
  const poolMinor = chargedMinor - Math.min(owedMinor, chargedMinor);
  return coverOldestFirst({
    charges: charges.map((line) => ({ key: line.key, on: line.statementOn, amountMinor: line.poolMinor, settled: false })),
    poolMinor,
    credits: [...cycleCredits, ...later].map((line) => ({ key: line.key, on: line.statementOn, amountMinor: -line.poolMinor })),
  });
}
