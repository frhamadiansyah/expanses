import { coverOldestFirst } from '@expanses/core';
import type { CardStatement, StatementLine } from '@expanses/db';
import { statementTotals } from './statement-totals';

/** How much of one charge on a statement its payments have covered. */
export interface LineCover {
  coveredMinor: number;
  /** What is still to pay of it: what ticking it and paying pays. */
  leftMinor: number;
  /** Covered whole: it shows as paid, and cannot be ticked. */
  whole: boolean;
  /** The payment (or money back) that completed its cover; null when the cover came from credit left from before. */
  by: StatementLine | null;
}

/** A charge the statement bills, as opposed to a payment, money back, or a purchase converted to a plan (counts nothing). */
export const isCharge = (line: StatementLine) => line.countedMinor > 0;

/** Settled on its own: paid one by one, or paid off before the app. Neither takes from the lump payments. */
const settledAlone = (line: StatementLine) => line.paidBy !== null || line.paidOff;

/**
 * Which of a statement's charges its payments cover, by line key, oldest first. Display only: nothing is stored, so
 * deleting the payment makes them owed again.
 *
 * The pool is what the totals band already shows as paid of this statement's charges, so the two always agree: a
 * statement down to nothing shows every charge paid, and the rows' amounts left add up to what the band says is left.
 * The band clears the oldest balance first, so what is still owed sits on the newest charges; the rest is paid. Money
 * back counts the way a payment does, since it takes as much off the bill. Charges settled on their own are taken out
 * of the pool at their whole amount, because their own payment (or balancing settlement) is in the band's figures too.
 * A refund marked settled before the app gives nothing: its hidden balancing charge spends it.
 */
export function statementCover(s: CardStatement): Map<string, LineCover> {
  const charges = s.lines.filter(isCharge);
  const t = statementTotals(s);
  const chargedMinor = charges.reduce((sum, line) => sum + line.countedMinor, 0);
  // What the band says is still owed, laid on the newest charges: a closed bill's left, an open cycle's unbilled left.
  const owedMinor = Math.min(t.closed ? t.leftMinor : t.unbilledLeftMinor, chargedMinor);
  const settledMinor = charges.filter(settledAlone).reduce((sum, line) => sum + line.countedMinor, 0);
  const poolMinor = chargedMinor - owedMinor - settledMinor;

  // The credits the band counts, less the payments made one by one for this statement's own purchases.
  const ownPayments = new Set(s.lines.flatMap((line) => (line.paidBy ? [line.paidBy.transactionId] : [])));
  const credits = [...s.lines, ...s.laterCredits].filter((line) => line.countedMinor < 0 && !line.paidOff && !ownPayments.has(line.transactionId));
  const byKey = new Map(credits.map((line) => [line.key, line]));

  const cover = coverOldestFirst({
    charges: charges.map((line) => ({ key: line.key, on: line.statementOn, amountMinor: line.countedMinor, settled: settledAlone(line) })),
    poolMinor,
    credits: credits.map((line) => ({ key: line.key, on: line.statementOn, amountMinor: -line.countedMinor })),
  });
  const out = new Map<string, LineCover>();
  for (const [key, c] of cover) out.set(key, { coveredMinor: c.coveredMinor, leftMinor: c.leftMinor, whole: c.whole, by: c.credit ? (byKey.get(c.credit.key) ?? null) : null });
  return out;
}

/** Whether a charge shows as paid: settled on its own, or covered whole. */
export const showsPaid = (line: StatementLine, cover: ReadonlyMap<string, LineCover>) => settledAlone(line) || cover.get(line.key)?.whole === true;

/** The heading's count: "All paid" once every charge shows paid, "2 of 4 paid" before; nothing with no charges. */
export function paidCountText(paid: number, of: number): string | null {
  if (of === 0) return null;
  return paid === of ? 'All paid' : `${paid} of ${of} paid`;
}
