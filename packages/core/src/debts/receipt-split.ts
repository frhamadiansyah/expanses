/**
 * A restaurant bill divided by who had what. Pure money logic on minor units: every figure is a whole number and
 * the shares add back to the bill exactly, whatever the currency's decimals.
 */

/** One dish and who shared it, as indexes into the people on the bill. An empty `sharedBy` is everybody. */
export interface SplitItem {
  amountMinor: number;
  sharedBy: readonly number[];
}

/** A service, tax, tip or discount line: shared in proportion to each person's food, or equally. */
export interface SplitCharge {
  /** Negative for a discount. */
  amountMinor: number;
  mode: 'pro-rata' | 'equal';
}

export interface ReceiptShares {
  /** What each person pays in all; adds up to the items plus the charges exactly. */
  totals: number[];
  /** What each person pays for dishes alone. */
  itemsMinor: number[];
  /** How many dishes each person is in. */
  itemCount: number[];
}

/**
 * `total` divided in proportion to `weights` in whole units, by the largest-remainder method: each gets its floor,
 * and the units left go one each to the largest fractional parts, the earlier person winning a tie. The shares add
 * to `total` exactly. All-zero weights divide equally. A negative total (a discount) is divided as its opposite.
 */
export function allocateByWeights(total: number, weights: readonly number[]): number[] {
  if (weights.length === 0) return [];
  if (total < 0) return allocateByWeights(-total, weights).map((share) => (share === 0 ? 0 : -share));
  const sum = weights.reduce((s, w) => s + Math.max(0, w), 0);
  const w = sum > 0 ? weights.map((x) => BigInt(Math.max(0, x))) : weights.map(() => 1n);
  const W = w.reduce((s, x) => s + x, 0n);
  const T = BigInt(total);
  const floors = w.map((x) => (T * x) / W);
  const rems = w.map((x) => (T * x) % W);
  let left = Number(T - floors.reduce((s, x) => s + x, 0n));
  const order = rems.map((r, i) => ({ r, i })).sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  const out = floors.map(Number);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i]! += 1;
    left -= 1;
  }
  return out;
}

/** Each person's share of the bill. `people` is how many are on it. */
export function splitReceipt(people: number, items: readonly SplitItem[], charges: readonly SplitCharge[]): ReceiptShares {
  const itemsMinor = Array.from({ length: people }, () => 0);
  const itemCount = Array.from({ length: people }, () => 0);
  for (const item of items) {
    const sharers = [...new Set(item.sharedBy.filter((i) => i >= 0 && i < people))].sort((a, b) => a - b);
    const among = sharers.length > 0 ? sharers : Array.from({ length: people }, (_, i) => i);
    const parts = allocateByWeights(item.amountMinor, among.map(() => 1));
    among.forEach((person, k) => {
      itemsMinor[person]! += parts[k]!;
      itemCount[person]! += 1;
    });
  }
  const totals = [...itemsMinor];
  for (const charge of charges) {
    // Someone with no food pays none of a pro-rata charge; with nobody having any, it falls equally.
    const parts = allocateByWeights(charge.amountMinor, charge.mode === 'equal' ? itemsMinor.map(() => 1) : itemsMinor);
    parts.forEach((part, i) => {
      totals[i]! += part;
    });
  }
  return { totals, itemsMinor, itemCount };
}
