/**
 * The points ledger: what was earned, spent, expired or corrected, and what is left.
 *
 * Entries are signed — earning and a positive correction add, spending, expiring and transferring out
 * take away. A consumption names the earn batch it came from, so what is left in a batch is that batch
 * plus everything drawn against it, and points expire batch by batch rather than in one pool.
 *
 * An entry is `posted` when it came from a figure the issuer showed, and `projected` when the app worked
 * it out from the rules. The two are counted apart, because a balance the owner can spend and a balance
 * the app believes in are different claims.
 */

import { roundHalfAwayFromZero } from '../money/money';

export type EntryKind = 'earn' | 'redeem' | 'expire' | 'adjust' | 'transfer';

/** Where an entry's figure came from, best evidence first. 'system' is the app's own act, such as
 * writing off a batch the issuer has already taken back. */
export type EntrySource = 'transaction' | 'statement' | 'snapshot' | 'projected' | 'manual' | 'system';

export interface PointEntry {
  id: string;
  kind: EntryKind;
  /** Signed: earn and a positive adjust are above zero; redeem, expire and transfer are below it. */
  quantity: number;
  occurredOn: string;
  status: 'posted' | 'projected';
  /** The earn batch this draws against. Null on an earn, and on an adjust that belongs to no batch. */
  batchId: string | null;
  /** When this batch dies. Null when the program has no expiry policy, which is the default. */
  expiresOn: string | null;
  source?: EntrySource;
}

export interface Balance {
  total: number;
  postedTotal: number;
  projectedTotal: number;
  /** Still held, in a batch dying within the window. */
  expiringSoon: number;
  /** The next date anything dies, however far off. Null when nothing has an expiry. */
  nextExpiryOn: string | null;
}

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

/** How a program's points die. None is the default: nothing expires until the owner says how. */
export type ExpiryPolicy = 'none' | 'months_from_earn' | 'fixed_annual';

const DEFAULT_SOON_DAYS = 60;

const addDays = (date: string, days: number): string => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
};

/** What is left in each earn batch: the batch itself, less everything drawn against it. */
function remainingByBatch(entries: PointEntry[]): Map<string, { remaining: number; expiresOn: string | null }> {
  const batches = new Map<string, { remaining: number; expiresOn: string | null }>();
  for (const entry of entries) {
    if (entry.kind === 'earn') batches.set(entry.id, { remaining: entry.quantity, expiresOn: entry.expiresOn });
  }
  for (const entry of entries) {
    if (entry.kind === 'earn' || entry.batchId === null) continue;
    const batch = batches.get(entry.batchId);
    // A consumption is negative, so adding it draws the batch down.
    if (batch) batch.remaining += entry.quantity;
  }
  return batches;
}

export function balanceOf(entries: PointEntry[], today: string, soonDays: number = DEFAULT_SOON_DAYS): Balance {
  let postedTotal = 0;
  let projectedTotal = 0;
  for (const entry of entries) {
    if (entry.status === 'projected') projectedTotal += entry.quantity;
    else postedTotal += entry.quantity;
  }

  const horizon = addDays(today, soonDays);
  let expiringSoon = 0;
  let nextExpiryOn: string | null = null;
  for (const batch of remainingByBatch(entries).values()) {
    if (batch.expiresOn === null || batch.remaining <= 0) continue;
    if (batch.expiresOn <= horizon) expiringSoon += batch.remaining;
    if (nextExpiryOn === null || batch.expiresOn < nextExpiryOn) nextExpiryOn = batch.expiresOn;
  }

  return { total: postedTotal + projectedTotal, postedTotal, projectedTotal, expiringSoon, nextExpiryOn };
}

/** When points earned on a day die under a policy. Null when they do not. */
export function expiresOn(earnedOn: string, policy: ExpiryPolicy, months: number | null): string | null {
  if (policy === 'none') return null;
  const [year, month, day] = earnedOn.split('-').map(Number);
  // Points earned any time in a year die with that year.
  if (policy === 'fixed_annual') return `${year}-12-31`;
  if (months === null || !Number.isFinite(months) || months <= 0) return null;
  return new Date(Date.UTC(year!, month! - 1 + months, day!)).toISOString().slice(0, 10);
}

/** Batches with something left, soonest to die first, leaving out any that already have. */
function liveBatches(entries: PointEntry[], onDate: string): { batchId: string; remaining: number; expiresOn: string | null; earnedOn: string }[] {
  const earnedOn = new Map(entries.filter((entry) => entry.kind === 'earn').map((entry) => [entry.id, entry.occurredOn]));
  return [...remainingByBatch(entries).entries()]
    .filter(([, batch]) => batch.remaining > 0 && (batch.expiresOn === null || batch.expiresOn >= onDate))
    .map(([batchId, batch]) => ({ batchId, remaining: batch.remaining, expiresOn: batch.expiresOn, earnedOn: earnedOn.get(batchId) ?? '' }))
    // What dies soonest goes first. Two batches under one policy sort the same either way, but the
    // moment a policy changes, spending the soonest-to-die is what stops points being lost.
    .sort((a, b) => (a.expiresOn ?? '9999-12-31').localeCompare(b.expiresOn ?? '9999-12-31') || a.earnedOn.localeCompare(b.earnedOn));
}

/**
 * Draws `quantity` from the batches that die soonest, spanning as many as it takes. Points already past
 * their date are not available to spend, because the issuer has taken them back.
 */
export function consumeFifo(entries: PointEntry[], quantity: number, onDate: string): { batchId: string; quantity: number }[] {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new LedgerError('Spend an amount above zero');

  const taken: { batchId: string; quantity: number }[] = [];
  let left = quantity;
  for (const batch of liveBatches(entries, onDate)) {
    if (left <= 0) break;
    const take = Math.min(batch.remaining, left);
    taken.push({ batchId: batch.batchId, quantity: take });
    left -= take;
  }
  if (left > 0) throw new LedgerError(`Only ${quantity - left} available, which is less than the ${quantity} asked for`);
  return taken;
}

/** Batches past their date that still hold something, and so have to be written off. */
export function dueToExpire(entries: PointEntry[], today: string): { batchId: string; quantity: number; expiresOn: string }[] {
  const due: { batchId: string; quantity: number; expiresOn: string }[] = [];
  for (const [batchId, batch] of remainingByBatch(entries)) {
    if (batch.expiresOn === null || batch.remaining <= 0 || batch.expiresOn > today) continue;
    due.push({ batchId, quantity: batch.remaining, expiresOn: batch.expiresOn });
  }
  return due.sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
}

export interface FeeRoiInput {
  entries: PointEntry[];
  from: string;
  to: string;
  /** Micro-rupiah a point is worth, so a point worth Rp 25 is 25_000_000. */
  valuePerPointMicro: number;
  annualFeeMinor: number;
}

export interface FeeRoi {
  pointsEarned: number;
  valueMinor: number;
  annualFeeMinor: number;
  netMinor: number;
  /** True when any of the points counted were worked out rather than confirmed by the issuer. */
  estimated: boolean;
}

/**
 * What a card year was worth: the points it earned, valued at a rate, less the annual fee.
 *
 * Only earning counts. Spending, expiring and corrections are left out because the fee bought the
 * earning — what was later done with the points is a separate question, and netting them here would
 * make a year look worse for having used its points.
 */
export function feeRoi(input: FeeRoiInput): FeeRoi {
  const earned = input.entries.filter((entry) => entry.kind === 'earn' && entry.occurredOn >= input.from && entry.occurredOn <= input.to);
  const pointsEarned = earned.reduce((total, entry) => total + entry.quantity, 0);
  const valueMinor = roundHalfAwayFromZero((pointsEarned * input.valuePerPointMicro) / 1_000_000);
  return {
    pointsEarned,
    valueMinor,
    annualFeeMinor: input.annualFeeMinor,
    netMinor: valueMinor - input.annualFeeMinor,
    estimated: earned.some((entry) => entry.status === 'projected'),
  };
}
