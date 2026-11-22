import type { CardStatement, StatementLine } from '@expanses/db';

/** How much of one charge on a statement its payments have covered. */
export interface LineCover {
  coveredMinor: number;
  /** What is still to pay of it: what ticking it and paying pays. */
  leftMinor: number;
  /** Covered whole: it shows as paid, and cannot be ticked. */
  whole: boolean;
  /** The payment (or money back) that completed its cover; null when the cover came from credit left from before. */
  by: StatementLine | null;
  /** How many payments (or money back) went into its cover; credit carried from before counts none. */
  creditCount: number;
}

/** A charge the statement bills, as opposed to a payment, money back, or a purchase converted to a plan (counts nothing). */
export const isCharge = (line: StatementLine) => line.countedMinor > 0;

/** Settled on its own: paid one by one, or paid off before the app. Neither takes from the lump payments. */
const settledAlone = (line: StatementLine) => line.paidBy !== null || line.paidOff;

/**
 * Which of a statement's charges the card's payments cover, by line key, with the credit that completed each one's
 * cover as a line to name and open. The ledger works the cover out (`CardStatement.cover`), so the statement and the
 * payment it offers always agree; this only finds the credit's line, in the statement or among the credits since.
 */
export function statementCover(s: CardStatement): Map<string, LineCover> {
  const credits = new Map([...s.lines, ...s.laterCredits].map((line) => [line.key, line]));
  const out = new Map<string, LineCover>();
  for (const [key, c] of Object.entries(s.cover)) {
    out.set(key, { coveredMinor: c.coveredMinor, leftMinor: c.leftMinor, whole: c.whole, by: c.creditKey ? (credits.get(c.creditKey) ?? null) : null, creditCount: c.credits });
  }
  return out;
}

/** Whether a charge shows as paid: settled on its own, or covered whole. */
export const showsPaid = (line: StatementLine, cover: ReadonlyMap<string, LineCover>) => settledAlone(line) || cover.get(line.key)?.whole === true;

/** The heading's count: "All paid" once every charge shows paid, "2 of 4 paid" before; nothing with no charges. */
export function paidCountText(paid: number, of: number): string | null {
  if (of === 0) return null;
  return paid === of ? 'All paid' : `${paid} of ${of} paid`;
}

/**
 * Whether a statement line can be ticked and paid on its own: a purchase still owed, not already paid one by one or
 * off before the app, not a plan's instalment or a purchase turned into one, and not covered whole by a payment.
 */
export const payableLine = (line: StatementLine, cover: ReadonlyMap<string, LineCover>) =>
  line.owedMinor > 0 && line.spending && !line.paidBy && !line.paidOff && !line.instalment && !line.convertedTo && cover.get(line.key)?.whole !== true;

const shortDay = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/**
 * How a line shown paid was paid, in the few words its ✓'s bubble says and its ✓'s name carries: "Paid 3 Nov"
 * one by one, "Paid with the 15 Nov payment" (or "with 2 payments") covered, "Paid before cicis" marked paid off,
 * "Settled" for money back so marked, and "Paid" for a plan's instalment ticked paid. Null for a line not shown paid.
 * The order is the ✓'s: a cover first, then the mark, then paid one by one.
 */
export function paidHowText(line: StatementLine, cover: ReadonlyMap<string, LineCover>): string | null {
  const covered = cover.get(line.key);
  if (covered?.whole) {
    if (covered.creditCount > 1) return `Paid with ${covered.creditCount} payments`;
    if (covered.by) return `Paid with the ${shortDay(covered.by.occurredOn)} ${covered.by.spending ? 'refund' : 'payment'}`;
    return 'Paid with earlier credit';
  }
  // An annual fee's money back, and the fee row added beside one reversed before the app, are settled on their own.
  if (line.feeSettled) return 'Settled';
  if (line.paidOff) return line.instalment ? 'Paid' : line.owedMinor < 0 ? 'Settled' : 'Paid off';
  if (line.paidBy) return `Paid ${shortDay(line.paidBy.paidOn)}`;
  return null;
}
