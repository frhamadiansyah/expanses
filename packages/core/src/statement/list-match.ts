import type { ListRow } from './list';
import { textOverlap } from './match';

/**
 * Laying a read transaction list against what the app holds for the same account (no card, no statement period).
 *
 * Pure: the caller loads the account's recorded entries around the list's dates. Two entries are the same when the date,
 * the amount and the direction are; the description only chooses between alike entries and decides whether a different
 * amount is the same purchase recorded wrongly.
 */

/** An entry recorded on the account. */
export interface ListCandidate {
  id: string;
  on: string;
  /** Positive, in the account's minor units. */
  amountMinor: number;
  direction: 'out' | 'in';
  description: string;
}

export type ListOutcome =
  /** Same account, date, amount and direction as a recorded entry. */
  | { row: number; status: 'recorded'; candidateId: string }
  /** Same date, direction and some of the name, another amount. */
  | { row: number; status: 'differs'; candidateId: string; listMinor: number; recordedMinor: number }
  | { row: number; status: 'new' }
  /** Paid in coins or points: not money, so never recorded. */
  | { row: number; status: 'skipped' };

export interface ListMatch {
  /** One outcome per row, in row order. */
  outcomes: ListOutcome[];
  /** Recorded entries dated inside the list's days that no row took, in candidate order. */
  notOnList: string[];
}

/** Greedy assignment of the best-ranked pairs first; each row and each candidate is taken at most once. */
function assign(pairs: { row: number; cand: number; rank: readonly number[] }[], taken: Set<number>, used: Set<number>): Map<number, number> {
  const made = new Map<number, number>();
  const sorted = [...pairs].sort((a, b) => {
    for (let k = 0; k < a.rank.length; k += 1) if (a.rank[k] !== b.rank[k]) return a.rank[k]! - b.rank[k]!;
    return a.row - b.row || a.cand - b.cand;
  });
  for (const p of sorted) {
    if (taken.has(p.row) || used.has(p.cand)) continue;
    taken.add(p.row);
    used.add(p.cand);
    made.set(p.row, p.cand);
  }
  return made;
}

export function matchList(rows: readonly ListRow[], candidates: readonly ListCandidate[]): ListMatch {
  const outcomes: ListOutcome[] = rows.map((_, row) => ({ row, status: 'new' }));
  const taken = new Set<number>();
  const used = new Set<number>();
  rows.forEach((r, i) => {
    if (r.coins) {
      outcomes[i] = { row: i, status: 'skipped' };
      taken.add(i);
    }
  });

  // 1. The same date, amount and direction. Alike entries go by the name that reads most alike, then in order.
  const exact: { row: number; cand: number; rank: number[] }[] = [];
  rows.forEach((r, row) => {
    if (r.coins) return;
    candidates.forEach((c, cand) => {
      if (c.on === r.on && c.amountMinor === r.amountMinor && c.direction === r.direction) exact.push({ row, cand, rank: [-textOverlap(r.description, c.description)] });
    });
  });
  for (const [row, cand] of assign(exact, taken, used)) outcomes[row] = { row, status: 'recorded', candidateId: candidates[cand]!.id };

  // 2. The same day and direction, a name in common, another amount: the entry was recorded with the wrong figure.
  const near: { row: number; cand: number; rank: number[] }[] = [];
  rows.forEach((r, row) => {
    if (taken.has(row)) return;
    candidates.forEach((c, cand) => {
      if (used.has(cand) || c.on !== r.on || c.direction !== r.direction) return;
      const overlap = textOverlap(r.description, c.description);
      if (overlap > 0) near.push({ row, cand, rank: [-overlap, Math.abs(c.amountMinor - r.amountMinor)] });
    });
  });
  for (const [row, cand] of assign(near, taken, used)) {
    const c = candidates[cand]!;
    outcomes[row] = { row, status: 'differs', candidateId: c.id, listMinor: rows[row]!.amountMinor, recordedMinor: c.amountMinor };
  }

  const days = rows.map((r) => r.on).sort();
  const first = days[0];
  const last = days[days.length - 1];
  const notOnList =
    first === undefined || last === undefined ? [] : candidates.filter((c, cand) => !used.has(cand) && c.on >= first && c.on <= last).map((c) => c.id);
  return { outcomes, notOnList };
}
