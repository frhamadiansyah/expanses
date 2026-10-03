/**
 * Matching a statement's rows with what cicis holds for the card (spec §3.2).
 *
 * Pure: the caller loads the candidates (the card's transactions and pending drafts around the period) and decides,
 * row by row, which credits look like a shop's refund. Notes never decide a match.
 */
import { merchantKeyOf } from './read';
import type { StatementPeriod, StatementRow } from './types';
import { STATEMENT_WORDS } from './words';

/** A transaction or a pending draft on the card that a statement row may be. */
export interface Candidate {
  /** The transaction id, or `draft:<id>` for a pending draft. */
  id: string;
  /** The date that counts: the posting date when one is set, otherwise the date it happened. ISO. */
  on: string;
  /** Positive, in the card currency's minor units. */
  amountMinor: number;
  direction: 'out' | 'in';
  /** `payment` is a transfer into the card. */
  kind: 'purchase' | 'refund' | 'payment';
  description: string;
  isDraft: boolean;
}

export type RowOutcome =
  | { row: number; status: 'matched'; candidateIds: string[] }
  | { row: number; status: 'differs'; candidateId: string; statementMinor: number; recordedMinor: number }
  | { row: number; status: 'missing'; as: 'purchase' | 'refund' | 'fee' | 'payment' }
  | { row: number; status: 'ask'; candidateIds: string[] }
  | { row: number; status: 'payment-untracked' };

export interface MatchResult {
  /** One outcome per row, in row order. */
  outcomes: RowOutcome[];
  /** Candidates dated inside the period that no row took, in candidate order. */
  flagged: string[];
}

export interface MatchOptions {
  period: StatementPeriod;
  /**
   * The card's setting. Either way a card payment matches a transfer into the card the owner recorded; what matches
   * nothing is missing (to record) when on, and `payment-untracked` (summed into one adjustment) when off.
   */
  trackPayments: boolean;
  /** Row index → the credit looks like a shop's refund (see `looksLikeRefund`). */
  refundHints: ReadonlyMap<number, boolean>;
}

/** Days either side of a row a purchase or a refund may be dated. */
const WINDOW_DAYS = 3;
/** Days either side of a row a card payment may be dated. */
const PAYMENT_WINDOW_DAYS = 5;
/** Rows summed into one payment lie this many days apart at most. */
const SUM_SPREAD_DAYS = 2;
/** At most this many rows sum to one payment. */
const SUM_MAX_ROWS = 4;
/** A recorded amount this close to the statement's (as a share of it) "differs" rather than is missing. */
const NEAR_SHARE = 0.05;

const DAY_MS = 86_400_000;

function dayNumber(iso: string): number {
  return Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
}

function daysApart(a: string, b: string): number {
  return Math.abs(dayNumber(a) - dayNumber(b));
}

function wordsOf(description: string): Set<string> {
  return new Set(merchantKeyOf(description).split(' ').filter((w) => w.length > 0));
}

/** Jaccard overlap of two descriptions' merchant words, 0..1. */
function textOverlap(a: string, b: string): number {
  const wa = wordsOf(a);
  const wb = wordsOf(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared += 1;
  return shared / (wa.size + wb.size - shared);
}

type Pool = 'purchase' | 'refund' | 'payment';

export function matchStatement(rows: readonly StatementRow[], candidates: readonly Candidate[], opts: MatchOptions): MatchResult {
  const used = new Set<string>();
  const outcomes = new Map<number, RowOutcome>();

  const poolOf = (i: number): Pool => {
    const r = rows[i]!;
    if (r.direction === 'out') return 'purchase';
    // A fee credited back (a reversal, a waiver) lowers the fees: money back, never the holder's payment.
    if (opts.refundHints.get(i) === true || (r.isFee && !PAYMENT_WORD.test(r.description))) return 'refund';
    return 'payment';
  };

  const windowOf = (pool: Pool): number => (pool === 'payment' ? PAYMENT_WINDOW_DAYS : WINDOW_DAYS);

  const eligible = (i: number, c: Candidate): boolean => {
    const r = rows[i]!;
    const pool = poolOf(i);
    if (used.has(c.id) || c.direction !== r.direction) return false;
    if (daysApart(r.on, c.on) > windowOf(pool)) return false;
    if (pool === 'purchase') return c.kind === 'purchase' || c.isDraft;
    return c.kind === pool;
  };

  /** Candidates ranked for a row: nearest date first, then the most words in common; input order last. */
  const ranked = (i: number, list: Candidate[]): { c: Candidate; days: number; text: number }[] => {
    const r = rows[i]!;
    return list
      .map((c) => ({ c, days: daysApart(r.on, c.on), text: textOverlap(r.description, c.description) }))
      .sort((a, b) => a.days - b.days || b.text - a.text);
  };

  // Rows in date order; equal dates keep statement order.
  const order = rows.map((_, i) => i).sort((a, b) => dayNumber(rows[a]!.on) - dayNumber(rows[b]!.on) || a - b);

  // 1. The same amount.
  for (const i of order) {
    if (outcomes.has(i)) continue;
    const r = rows[i]!;
    const exact = ranked(i, candidates.filter((c) => eligible(i, c) && c.amountMinor === r.amountMinor));
    if (exact.length === 0) continue;
    const best = exact[0]!;
    const tied = exact.filter((e) => e.days === best.days && e.text === best.text).map((e) => e.c);
    if (tied.length > 1) {
      // Rows still open that read exactly like this one can take the tied candidates in turn: nothing to ask then.
      // With more tied candidates than such rows, every one of those rows asks over the same candidates.
      const alike = order.filter((j) => !outcomes.has(j) && poolOf(j) === poolOf(i) && rows[j]!.amountMinor === r.amountMinor
        && rows[j]!.on === r.on && merchantKeyOf(rows[j]!.description) === merchantKeyOf(r.description));
      if (alike.length < tied.length) {
        const candidateIds = tied.map((c) => c.id);
        for (const id of candidateIds) used.add(id);
        for (const j of alike) outcomes.set(j, { row: j, status: 'ask', candidateIds: [...candidateIds] });
        continue;
      }
    }
    used.add(best.c.id);
    outcomes.set(i, { row: i, status: 'matched', candidateIds: [best.c.id] });
  }

  // 2. Card payments the bank split over several rows, paid as one transfer. Even with payments not tracked, a payment
  // the owner did record is that payment: matched, never counted again in the untracked adjustment.
  {
    const payments = candidates.filter((c) => c.direction === 'in' && c.kind === 'payment')
      .sort((a, b) => dayNumber(a.on) - dayNumber(b.on));
    for (const c of payments) {
      if (used.has(c.id)) continue;
      const open = order.filter((i) => !outcomes.has(i) && poolOf(i) === 'payment' && eligible(i, c));
      const subset = subsetSumming(open, (i) => rows[i]!.amountMinor, (i) => dayNumber(rows[i]!.on), c.amountMinor);
      if (subset === null) continue;
      used.add(c.id);
      for (const i of subset) outcomes.set(i, { row: i, status: 'matched', candidateIds: [c.id] });
    }
  }

  // 3. A near amount: the row differs from what was recorded.
  for (const i of order) {
    // With payments not tracked, a payment that matches nothing exactly goes to the adjustment, not to a correction.
    if (outcomes.has(i) || (!opts.trackPayments && poolOf(i) === 'payment')) continue;
    const r = rows[i]!;
    const gap = (c: Candidate) => Math.abs(c.amountMinor - r.amountMinor);
    // The closest amount first; then the date and the text, as for an exact amount.
    const near = ranked(i, candidates.filter((c) => eligible(i, c) && gap(c) <= NEAR_SHARE * r.amountMinor))
      .sort((a, b) => gap(a.c) - gap(b.c));
    if (near.length === 0) continue;
    const best = near[0]!.c;
    used.add(best.id);
    outcomes.set(i, { row: i, status: 'differs', candidateId: best.id, statementMinor: r.amountMinor, recordedMinor: best.amountMinor });
  }

  // 4. Whatever is left is missing from cicis.
  for (const i of order) {
    if (outcomes.has(i)) continue;
    const r = rows[i]!;
    const pool = poolOf(i);
    if (pool === 'payment' && !opts.trackPayments) {
      outcomes.set(i, { row: i, status: 'payment-untracked' });
      continue;
    }
    // Only a charge is a fee; a fee row credited back is money back, filed under the fees it lowers.
    const as = pool === 'purchase' ? (r.isFee ? 'fee' : 'purchase') : pool;
    outcomes.set(i, { row: i, status: 'missing', as });
  }

  const flagged = candidates
    .filter((c) => !used.has(c.id) && c.on >= opts.period.start && c.on <= opts.period.end)
    .map((c) => c.id);

  return { outcomes: rows.map((_, i) => outcomes.get(i)!), flagged };
}

/** The first set of 2..SUM_MAX_ROWS items, dated within SUM_SPREAD_DAYS of each other, whose amounts sum to `target`. */
function subsetSumming(items: number[], amount: (i: number) => number, day: (i: number) => number, target: number): number[] | null {
  const pick: number[] = [];
  const search = (from: number, sum: number, lo: number, hi: number): boolean => {
    if (pick.length >= 2 && sum === target) return true;
    if (pick.length === SUM_MAX_ROWS) return false;
    for (let k = from; k < items.length; k += 1) {
      const i = items[k]!;
      const next = sum + amount(i);
      const d = day(i);
      const nlo = Math.min(lo, d);
      const nhi = Math.max(hi, d);
      if (next > target || nhi - nlo > SUM_SPREAD_DAYS) continue;
      pick.push(i);
      if (search(k + 1, next, nlo, nhi)) return true;
      pick.pop();
    }
    return false;
  };
  return search(0, 0, Infinity, -Infinity) ? [...pick] : null;
}

const PAYMENT_WORD = new RegExp(`\\b(?:${STATEMENT_WORDS.paymentWords.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');

/**
 * Whether a credit row reads like a shop's refund rather than the card holder's payment. A row naming a payment never
 * does; otherwise it does when it names a merchant the card bought from earlier (half or more of the merchant words in
 * common), equals an earlier purchase's amount, or names something shop-like (a merchant word of three letters or
 * more). Out rows never do.
 */
export function looksLikeRefund(row: StatementRow, earlierPurchases: readonly { description: string; amountMinor: number }[]): boolean {
  if (row.direction !== 'in' || PAYMENT_WORD.test(row.description)) return false;
  if (earlierPurchases.some((p) => textOverlap(row.description, p.description) >= 0.5 || p.amountMinor === row.amountMinor)) return true;
  return [...wordsOf(row.description)].some((w) => /\p{L}{3,}/u.test(w));
}
