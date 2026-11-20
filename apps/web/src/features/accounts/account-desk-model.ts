import type { RowType } from '../transactions/list-model';

/*
 * A money account's page on a wide screen (Mac account pages, owner 2026-11-20) as data: the month's in and out, the
 * balance after each row as a bank statement prints it, and the balance at the end of each of the last six months.
 * Everything is read from what moved the account (its own entries, in its own currency) and today's balance — the
 * figure Wallet, the sidebar and the phone's account page print — walked back, so the page ends on that same figure.
 */

/** What one transaction did to the account, in the account's currency, and what kind of row it is. */
export interface AccountMove {
  id: string;
  /** YYYY-MM-DD. */
  on: string;
  /** Signed: positive when money came into the account. */
  minor: number;
  type: RowType;
}

/** Which line of the month's box a row counts on. One rule: by what the row is, then by which way the money went. */
export type MoveLine = 'in' | 'out' | 'transferIn' | 'transferOut' | 'adjusted' | 'opening';

export function moveLine(move: Pick<AccountMove, 'minor' | 'type'>): MoveLine {
  if (move.type === 'opening') return 'opening';
  if (move.type === 'correction') return 'adjusted';
  if (move.type === 'transfer') return move.minor < 0 ? 'transferOut' : 'transferIn';
  return move.minor < 0 ? 'out' : 'in';
}

/** The month's box: every line it can show, and the change they add up to. Out-lines are positive amounts. */
export interface AccountMonth {
  inMinor: number;
  outMinor: number;
  transferInMinor: number;
  transferOutMinor: number;
  /** Balance adjustments, signed (a count above the balance is positive). */
  adjustedMinor: number;
  /** The opening balance, when the account was opened inside the month. */
  openingMinor: number;
  /** What the month moved the balance by: in − out + transfers in − transfers out + adjusted + opening. */
  changeMinor: number;
}

/** The month's figures from the moves dated inside it (`from`..`to`, both inclusive). */
export function accountMonth(moves: readonly AccountMove[], period: { from: string; to: string }): AccountMonth {
  const month: AccountMonth = { inMinor: 0, outMinor: 0, transferInMinor: 0, transferOutMinor: 0, adjustedMinor: 0, openingMinor: 0, changeMinor: 0 };
  for (const move of moves) {
    if (move.on < period.from || move.on > period.to) continue;
    const line = moveLine(move);
    if (line === 'in') month.inMinor += move.minor;
    else if (line === 'out') month.outMinor -= move.minor;
    else if (line === 'transferIn') month.transferInMinor += move.minor;
    else if (line === 'transferOut') month.transferOutMinor -= move.minor;
    else if (line === 'adjusted') month.adjustedMinor += move.minor;
    else month.openingMinor += move.minor;
    month.changeMinor += move.minor;
  }
  return month;
}

/**
 * The balance after each row, as a statement prints it. `moves` is every move from some day up to the newest (future-dated
 * ones included), newest first as the list sorts them; `todayMinor` the account's balance, which counts all of them.
 * Walked down from the top: the newest row leaves the balance at today's figure, and each row below it left the balance
 * at what the row above found.
 */
export function balancesAfter(moves: readonly AccountMove[], todayMinor: number): Map<string, number> {
  const out = new Map<string, number>();
  let after = todayMinor;
  for (const move of moves) {
    out.set(move.id, after);
    after -= move.minor;
  }
  return out;
}

/**
 * The balance at the end of each month (`months`, oldest first, each with its last day), walked back from today's
 * balance through every move dated after that day. A month still running ends on today's balance.
 */
export function monthEndBalances(moves: readonly AccountMove[], todayMinor: number, months: readonly { month: string; to: string }[]): { month: string; minor: number }[] {
  return months.map(({ month, to }) => ({
    month,
    minor: todayMinor - moves.reduce((sum, move) => (move.on > to ? sum + move.minor : sum), 0),
  }));
}

/** What a transaction moved one account (or any of a parent's pockets) by: the sum of its entries there. */
export function moveOf(tx: { entries: readonly { accountId: string; amountMinor: number }[] }, ids: ReadonlySet<string>): number {
  return tx.entries.reduce((sum, entry) => (ids.has(entry.accountId) ? sum + entry.amountMinor : sum), 0);
}
