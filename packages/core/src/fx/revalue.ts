import { FxError } from './fifo';

/*
 * One transaction's base figures once the money leaving (or arriving in) a foreign account has its cost (withdrawal
 * rate §4, §5). The caller says what each line is (`role`); this says what each line is worth in base, and how big an
 * exchange gain or loss is (positive: a gain). Every currency's lines still add up to zero in base afterwards, and a
 * line in the base currency never changes: its figure is its amount.
 */

export type FxRole = 'lot' | 'exchange' | 'money' | 'other';

export interface FxLine {
  entryId: string;
  currency: string;
  amountMinor: number;
  amountBaseMinor: number;
  role: FxRole;
}

/**
 * `total` shared by `weights`, each part rounded toward zero and the whole remainder on the largest weight (the first
 * of equal ones): "the rounding remainder on the largest" (§4, ruling R5). Weights of zero in all leave it all on the
 * first. BigInt, because a cost times a weight can pass 2^53.
 */
export function spreadBase(total: number, weights: readonly number[]): number[] {
  if (weights.length === 0) throw new FxError('Nothing to share a cost over');
  if (!Number.isSafeInteger(total)) throw new FxError(`A cost is a whole number of minor units, got ${total}`);
  const largest = weights.reduce((best, weight, i) => (Math.abs(weight) > Math.abs(weights[best]!) ? i : best), 0);
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  const parts = weights.map(() => 0);
  if (sum === 0) {
    parts[largest] = total;
    return parts;
  }
  weights.forEach((weight, i) => {
    if (!Number.isSafeInteger(weight)) throw new FxError(`A weight is a whole number, got ${weight}`);
    parts[i] = Number((BigInt(total) * BigInt(weight)) / BigInt(sum));
  });
  parts[largest] = parts[largest]! + total - parts.reduce((acc, part) => acc + part, 0);
  return parts;
}

export type InflowCost = { kind: 'stored' } | { kind: 'carried'; fromEntryIds: string[] } | { kind: 'exchanged'; costs: Record<string, number> };

/**
 * What money arriving in a foreign account cost (§3, ruling R11): moved from another of the owner's pockets in the same
 * currency, it is what that pocket's own lots cost (carried — written by that pocket's recalculation); changed from
 * the base currency, it is the base amount that left (exchanged — written here, for every pocket it arrived in); any
 * other way in keeps the figure it was posted at (stored).
 */
export function classifyInflow(lines: readonly FxLine[], entryId: string, baseCurrency: string): InflowCost {
  const arriving = lines.find((l) => l.entryId === entryId);
  if (!arriving || arriving.role !== 'lot' || arriving.amountMinor <= 0) throw new FxError(`${entryId} is not money arriving in a foreign account`);
  const fromPocket = lines.filter((l) => l.role === 'lot' && l.amountMinor < 0 && l.currency === arriving.currency);
  if (fromPocket.length > 0) return { kind: 'carried', fromEntryIds: fromPocket.map((l) => l.entryId) };
  if (!lines.some((l) => l.role === 'exchange' && l.currency === arriving.currency)) return { kind: 'stored' };
  const source = lines.filter((l) => l.role !== 'exchange' && l.currency !== arriving.currency && l.amountMinor < 0);
  if (source.length === 0 || source.some((l) => l.currency !== baseCurrency || l.role !== 'money')) return { kind: 'stored' };
  const pockets = lines.filter((l) => l.role === 'lot' && l.amountMinor > 0 && l.currency === arriving.currency);
  const shares = spreadBase(-source.reduce((sum, l) => sum + l.amountMinor, 0), pockets.map((l) => l.amountMinor));
  return { kind: 'exchanged', costs: Object.fromEntries(pockets.map((l, i) => [l.entryId, shares[i]!])) };
}

export interface RevalueInput {
  lines: readonly FxLine[];
  baseCurrency: string;
  /** Money leaving a foreign account, by entry: its cost in base, positive. */
  outCosts?: Readonly<Record<string, number>>;
  /** Money arriving in a foreign account from the base currency, by entry: what it cost, positive. */
  inCosts?: Readonly<Record<string, number>>;
}

export interface Revalued {
  bases: Record<string, number>;
  /** Positive: an exchange gain; negative: a loss; zero: none. Its line is the caller's to write (R8). */
  gainLossBaseMinor: number;
}

/**
 * Every line's base figure once its foreign money has its cost (§4):
 *
 * - Within one currency (no exchange line): spending, a move to another pocket, a card paid — the cost is shared over the
 *   other lines by their day figures (R5); a pocket on the other side takes it as carried.
 * - Across currencies, between the owner's own accounts (something received is a money account or another pocket): what
 *   was received keeps its own figure, and the gap is the gain or loss (R6).
 * - Across currencies, spending only (a shared event's expense in another currency): the cost is shared over the
 *   received lines not in the base currency; base-currency lines keep their figure, and only a gap they leave is a gain
 *   or loss (R7).
 *
 * The exchange lines of each foreign currency are then set so that currency adds up to zero in base again; the gain or
 * loss is what the exchange account would otherwise be left holding.
 */
export function revalueTransaction(input: RevalueInput): Revalued {
  const { lines, baseCurrency } = input;
  const outCosts = input.outCosts ?? {};
  const inCosts = input.inCosts ?? {};
  const outIds = Object.keys(outCosts);
  const inIds = Object.keys(inCosts);
  if (outIds.length > 0 && inIds.length > 0) throw new FxError('A transaction is revalued for money leaving or for money arriving, not both at once');
  const byId = new Map(lines.map((l) => [l.entryId, l]));
  const bases: Record<string, number> = Object.fromEntries(lines.map((l) => [l.entryId, l.amountBaseMinor]));
  for (const id of outIds) {
    const leaving = byId.get(id);
    if (!leaving || leaving.role !== 'lot' || leaving.amountMinor >= 0) throw new FxError(`${id} is not money leaving a foreign account`);
    bases[id] = -outCosts[id]!;
  }
  for (const id of inIds) {
    const arriving = byId.get(id);
    if (!arriving || arriving.role !== 'lot' || arriving.amountMinor <= 0) throw new FxError(`${id} is not money arriving in a foreign account`);
    bases[id] = inCosts[id]!;
  }

  const exchange = lines.filter((l) => l.role === 'exchange');
  const rebalance = () => {
    for (const currency of new Set(exchange.map((l) => l.currency))) {
      if (currency === baseCurrency) continue;
      const own = exchange.filter((l) => l.currency === currency);
      const rest = lines.filter((l) => l.role !== 'exchange' && l.currency === currency).reduce((sum, l) => sum + bases[l.entryId]!, 0);
      spreadBase(-rest, own.map((l) => l.amountMinor)).forEach((value, i) => (bases[own[i]!.entryId] = value));
    }
  };
  if (outIds.length === 0) {
    rebalance();
    return { bases, gainLossBaseMinor: 0 };
  }

  const leaving = lines.filter((l) => l.role === 'lot' && l.amountMinor < 0);
  const received = lines.filter((l) => l.role !== 'exchange' && !(l.role === 'lot' && l.amountMinor < 0));
  const costOf = (ls: readonly FxLine[]) => ls.reduce((sum, l) => sum - bases[l.entryId]!, 0);
  const share = (targets: readonly FxLine[], total: number) => {
    if (targets.length === 0) throw new FxError('Money left a foreign account with nothing on the other side to carry its cost');
    const stored = targets.map((l) => l.amountBaseMinor);
    const weights = stored.reduce((sum, w) => sum + w, 0) !== 0 ? stored : targets.map((l) => l.amountMinor);
    spreadBase(total, weights).forEach((value, i) => (bases[targets[i]!.entryId] = value));
  };

  if (exchange.length === 0) {
    for (const currency of new Set(leaving.map((l) => l.currency))) {
      share(
        received.filter((l) => l.currency === currency),
        costOf(leaving.filter((l) => l.currency === currency)),
      );
    }
    return { bases, gainLossBaseMinor: 0 };
  }

  const betweenOwnAccounts = received.some((l) => l.role === 'money' || l.role === 'lot');
  if (!betweenOwnAccounts) {
    const free = received.filter((l) => l.currency !== baseCurrency);
    const fixed = received.filter((l) => l.currency === baseCurrency).reduce((sum, l) => sum + bases[l.entryId]!, 0);
    if (free.length > 0) share(free, costOf(leaving) - fixed);
  }
  rebalance();
  return { bases, gainLossBaseMinor: 0 - exchange.reduce((sum, l) => sum + bases[l.entryId]!, 0) }; // `0 -`, so no gain is never -0
}
