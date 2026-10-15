import { compareWithinDay } from '../ledger/day-order';

/*
 * First in, first out (withdrawal rate §3, §4, §6). One foreign account's movements in, every outflow's cost out: the
 * oldest lots still open are used first, and what no lot covers is valued at the figure the line was first posted at
 * (ruling R4) and recorded as a shortfall. No database, no rates: the caller hands in each movement's own figures.
 */

export class FxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FxError';
  }
}

/** A piece of a lot: money that came in at one cost on one date. A move between pockets carries several (§3). */
export interface FxLotPart {
  /** The entry the money first arrived on, in whichever account that was: what "From the 12 Nov withdrawal" names. */
  lotId: string;
  lotDate: string;
  minor: number;
  costBaseMinor: number;
}

interface FxMovementBase {
  entryId: string;
  occurredOn: string;
  dayOrder: number | null;
  createdAt: string;
  /** Always positive: the direction is `kind`. */
  minor: number;
}

export interface FxInflow extends FxMovementBase {
  kind: 'in';
  costBaseMinor: number;
  /** The lots it brings, with their own dates and costs; absent, it is one lot of its own, dated the day it arrived. */
  parts?: readonly FxLotPart[];
}

export interface FxOutflow extends FxMovementBase {
  kind: 'out';
  /** What the line was first posted at, in base: the value of whatever no lot covers (R4). Positive. */
  dayValueBaseMinor: number;
}

export type FxMovement = FxInflow | FxOutflow;

export interface FxLotUse {
  lotId: string;
  minor: number;
  costBaseMinor: number;
}

export interface FxOutCost {
  entryId: string;
  /** Lots used plus the uncovered part: what the outflow's money line is worth in base, positive. */
  costBaseMinor: number;
  /** One per lot, oldest first; a lot that arrived in two pieces is named once. */
  uses: FxLotUse[];
  uncoveredMinor: number;
  uncoveredBaseMinor: number;
}

export interface FxOpenLot {
  lotId: string;
  lotDate: string;
  minor: number;
  costBaseMinor: number;
  leftMinor: number;
  leftCostBaseMinor: number;
}

export interface FxShortfall {
  entryId: string;
  uncoveredMinor: number;
}

export interface FifoResult {
  /** In the order the money went out. */
  outs: FxOutCost[];
  /** What is still held, oldest first. */
  open: FxOpenLot[];
  shortfalls: FxShortfall[];
}

/**
 * `total × part / whole`, rounded half up, through BigInt: a lot of ₺90.000.000 at Rp 525 is already past what a
 * double multiplies exactly. Used cumulatively — the cost of the units from `a` to `b` is `shareOf(b) − shareOf(a)` —
 * so a lot's pieces always add up to its cost, however it is cut.
 */
export function shareOf(total: number, part: number, whole: number): number {
  if (!Number.isSafeInteger(whole) || whole <= 0) throw new FxError(`A share is of a positive whole number, got ${whole}`);
  if (!Number.isSafeInteger(part) || part < 0 || part > whole) throw new FxError(`A share is of a part between 0 and ${whole}, got ${part}`);
  if (part === whole) return total;
  if (part === 0 || total === 0) return 0;
  const magnitude = (BigInt(Math.abs(total)) * BigInt(part) * 2n + BigInt(whole)) / (2n * BigInt(whole));
  return total < 0 ? -Number(magnitude) : Number(magnitude);
}

/**
 * The order money moved (spec §4, ruling R3): by date; within a day money in before money out; then as the day's list
 * reads from the bottom up — the list shows a day newest first (`compareWithinDay`), so the row shown lower happened
 * earlier — and last by entry id, so the order is total and never depends on how the rows were handed in.
 */
export function chronological(a: FxMovement, b: FxMovement): number {
  if (a.occurredOn !== b.occurredOn) return a.occurredOn < b.occurredOn ? -1 : 1;
  if (a.kind !== b.kind) return a.kind === 'in' ? -1 : 1;
  const within = compareWithinDay(b, a);
  if (within !== 0) return within;
  return a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0;
}

interface Queued extends FxOpenLot {
  seq: number;
}

const byAge = (a: Queued, b: Queued) => (a.lotDate !== b.lotDate ? (a.lotDate < b.lotDate ? -1 : 1) : a.seq - b.seq);

const wholePositive = (value: number, what: string) => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new FxError(`${what} is a positive whole number of minor units, got ${value}`);
};

/**
 * Every outflow's cost, oldest lot first (§4). Lots wait in a queue ordered by their own date (a lot moved in from
 * another pocket keeps its withdrawal date, §3), then by when they arrived; an outflow can only use what has arrived
 * before it.
 */
export function fifoCosts(movements: readonly FxMovement[], opening: readonly FxLotPart[] = []): FifoResult {
  const seen = new Set<string>();
  for (const movement of movements) {
    wholePositive(movement.minor, `Movement ${movement.entryId}`);
    if (seen.has(movement.entryId)) throw new FxError(`Entry ${movement.entryId} appears twice`);
    seen.add(movement.entryId);
  }
  const queue: Queued[] = [];
  let seq = 0;
  const arrive = (part: FxLotPart) => {
    wholePositive(part.minor, `A piece of lot ${part.lotId}`);
    queue.push({ ...part, leftMinor: part.minor, leftCostBaseMinor: part.costBaseMinor, seq: seq++ });
    queue.sort(byAge);
  };
  opening.forEach(arrive);

  const outs: FxOutCost[] = [];
  const shortfalls: FxShortfall[] = [];
  for (const movement of [...movements].sort(chronological)) {
    if (movement.kind === 'in') {
      const parts = movement.parts && movement.parts.length > 0 ? movement.parts : [{ lotId: movement.entryId, lotDate: movement.occurredOn, minor: movement.minor, costBaseMinor: movement.costBaseMinor }];
      const sum = parts.reduce((total, part) => total + part.minor, 0);
      if (sum !== movement.minor) throw new FxError(`The lots of ${movement.entryId} add up to ${sum}, not ${movement.minor}`);
      parts.forEach(arrive);
      continue;
    }
    let need = movement.minor;
    const uses = new Map<string, FxLotUse>();
    for (const lot of queue) {
      if (need === 0) break;
      if (lot.leftMinor === 0) continue;
      const take = Math.min(need, lot.leftMinor);
      const usedBefore = lot.minor - lot.leftMinor;
      const cost = shareOf(lot.costBaseMinor, usedBefore + take, lot.minor) - shareOf(lot.costBaseMinor, usedBefore, lot.minor);
      lot.leftMinor -= take;
      lot.leftCostBaseMinor = lot.costBaseMinor - shareOf(lot.costBaseMinor, lot.minor - lot.leftMinor, lot.minor);
      need -= take;
      const held = uses.get(lot.lotId);
      if (held) {
        held.minor += take;
        held.costBaseMinor += cost;
      } else uses.set(lot.lotId, { lotId: lot.lotId, minor: take, costBaseMinor: cost });
    }
    const uncoveredBaseMinor = need === 0 ? 0 : shareOf(movement.dayValueBaseMinor, need, movement.minor);
    const used = [...uses.values()];
    outs.push({
      entryId: movement.entryId,
      costBaseMinor: used.reduce((total, use) => total + use.costBaseMinor, 0) + uncoveredBaseMinor,
      uses: used,
      uncoveredMinor: need,
      uncoveredBaseMinor,
    });
    if (need > 0) shortfalls.push({ entryId: movement.entryId, uncoveredMinor: need });
  }
  const open = queue
    .filter((lot) => lot.leftMinor > 0)
    .map((lot): FxOpenLot => ({ lotId: lot.lotId, lotDate: lot.lotDate, minor: lot.minor, costBaseMinor: lot.costBaseMinor, leftMinor: lot.leftMinor, leftCostBaseMinor: lot.leftCostBaseMinor }));
  return { outs, open, shortfalls };
}
