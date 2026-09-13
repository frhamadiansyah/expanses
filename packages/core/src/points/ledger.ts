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

export type EntryKind = 'earn' | 'redeem' | 'expire' | 'adjust' | 'transfer';

/** Where an entry's figure came from, best evidence first. */
export type EntrySource = 'transaction' | 'statement' | 'snapshot' | 'projected' | 'manual';

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
