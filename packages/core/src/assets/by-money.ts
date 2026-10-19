import { divRound, unitsValueMinor } from './units';
import type { ValuationRow } from './value';
import { type Position, positionAfter, sellBasisMinor, TradeError, type TradeRecord, type YearBucket } from './position';

/**
 * A holding tracked by money (a mutual fund): what went in, what came out, and the total the platform shows when the
 * owner looks. Units and a NAV are optional; nothing here needs them.
 */

/** Money into (+) or out of (−) a holding by money, on a day: a buy's amount, a sell's proceeds. */
export interface MoneyFlow {
  occurredOn: string;
  amountMinor: number;
  /** When it was saved: of a buy and a value typed on the same day, the one saved later saw the other. */
  createdAt?: string;
}

const byTradeOrder = (a: TradeRecord, b: TradeRecord) =>
  a.occurredOn.localeCompare(b.occurredOn) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/** A holding's buys (+) and sells (−) as money, in trade order. Income and unit changes move no value. */
export function moneyFlows(trades: readonly TradeRecord[]): MoneyFlow[] {
  return [...trades]
    .sort(byTradeOrder)
    .filter((trade) => trade.kind === 'buy' || trade.kind === 'sell')
    .map((trade) => ({ occurredOn: trade.occurredOn, amountMinor: trade.kind === 'buy' ? trade.grossMinor : -trade.grossMinor, createdAt: trade.createdAt }));
}

/**
 * The money still in that a sell takes out: the same share of it as the sell takes of the value. Taking all of the value,
 * or more, takes all of the money; a holding with no value left gives up whatever money is still in it.
 */
export function moneySellBasis(costMinor: number, valueBeforeMinor: number, grossMinor: number): number {
  if (grossMinor < 0) throw new TradeError('INVALID_AMOUNT', 'A sell cannot be negative');
  if (costMinor <= 0) return 0;
  if (valueBeforeMinor <= 0 || grossMinor >= valueBeforeMinor) return costMinor;
  return Number(divRound(BigInt(costMinor) * BigInt(grossMinor), BigInt(valueBeforeMinor)));
}

/** Shares a whole out of year buckets by their cost, the rounding difference to the largest. */
function shareCost(buckets: YearBucket[], total: number, target: number): void {
  if (buckets.length === 0) return;
  if (total <= 0) {
    for (const bucket of buckets) bucket.costMinor = 0;
    return;
  }
  let given = 0;
  for (const bucket of buckets) {
    bucket.costMinor = Number(divRound(BigInt(bucket.costMinor) * BigInt(target), BigInt(total)));
    given += bucket.costMinor;
  }
  const largest = buckets.reduce((best, bucket) => (bucket.costMinor > best.costMinor ? bucket : best), buckets[0]!);
  largest.costMinor += target - given;
}

/**
 * Money still in, and profit taken, after walking a holding's trades by money. A sell gives up the cost it was saved
 * with (`basisMinor`, fixed when it was recorded); a sell from before the holding was tracked by money has none and
 * takes the average cost of the units it sold, as it did then. Units are kept when trades carry them, never required.
 */
export function moneyPositionAfter(trades: readonly TradeRecord[], upTo?: string): Position {
  const position: Position = { unitsMicro: 0, costMinor: 0, realizedMinor: 0, incomeMinor: 0, byYear: {} };
  for (const trade of [...trades].sort(byTradeOrder)) {
    if (upTo && trade.occurredOn > upTo) continue;
    if (trade.grossMinor < 0 || trade.feeMinor < 0 || trade.taxMinor < 0) {
      throw new TradeError('INVALID_AMOUNT', 'Amounts on a trade cannot be negative');
    }
    if (trade.kind === 'buy') {
      const cost = trade.grossMinor + trade.feeMinor + trade.taxMinor;
      const bucket = (position.byYear[trade.occurredOn.slice(0, 4)] ??= { unitsMicro: 0, costMinor: 0 });
      position.costMinor += cost;
      bucket.costMinor += cost;
      position.unitsMicro += Math.max(0, trade.unitsMicro);
      bucket.unitsMicro += Math.max(0, trade.unitsMicro);
    } else if (trade.kind === 'sell') {
      const basis =
        trade.basisMinor ?? (trade.unitsMicro > 0 && position.unitsMicro > 0 ? sellBasisMinor(position, Math.min(trade.unitsMicro, position.unitsMicro)) : 0);
      const costLeft = Math.max(0, position.costMinor - basis);
      const buckets = Object.values(position.byYear);
      shareCost(buckets, position.costMinor, costLeft);
      const unitsLeft = Math.max(0, position.unitsMicro - Math.max(0, trade.unitsMicro));
      for (const bucket of buckets) bucket.unitsMicro = position.unitsMicro > 0 ? Number(divRound(BigInt(bucket.unitsMicro) * BigInt(unitsLeft), BigInt(position.unitsMicro))) : 0;
      position.unitsMicro = unitsLeft;
      position.costMinor = costLeft;
      position.realizedMinor += trade.grossMinor - trade.feeMinor - trade.taxMinor - basis;
    } else if (trade.kind === 'income') {
      position.incomeMinor += trade.grossMinor - trade.taxMinor;
    }
  }
  for (const [year, bucket] of Object.entries(position.byYear)) {
    if (bucket.costMinor <= 0) delete position.byYear[year];
  }
  return position;
}

/**
 * The values a holding's past NAVs stand for, so a fund that moved from units to money keeps its history: each NAV
 * typed before, times the units held that day, is a value typed on that day. Days with no units held give none.
 */
export function navAnchors(trades: readonly TradeRecord[], prices: readonly { onDate: string; priceMicro: number }[]): ValuationRow[] {
  const anchors: ValuationRow[] = [];
  for (const price of prices) {
    const units = moneyPositionAfter(trades, price.onDate).unitsMicro;
    if (units > 0) anchors.push({ asOf: price.onDate, valueMinor: unitsValueMinor(units, price.priceMicro), basis: 'estimate' });
  }
  return anchors;
}

/**
 * What `assetValueAt` needs to value a holding tracked by money on a date: the money still in, the values typed (and
 * the past NAVs as values, first, so a value typed the same day wins), and the buys and sells that move it.
 */
export function byMoneyInputs(
  trades: readonly TradeRecord[],
  prices: readonly { onDate: string; priceMicro: number }[],
  valuations: readonly ValuationRow[],
  date: string,
): { position: Position; valuations: ValuationRow[]; flows: MoneyFlow[] } {
  return { position: moneyPositionAfter(trades, date), valuations: [...navAnchors(trades, prices), ...valuations], flows: moneyFlows(trades) };
}

/**
 * A holding's position by whichever rule its trades need: by money once any buy or sell carries no units or a saved
 * cost (a fund tracked by money), by units otherwise. For readers that walk every holding at once.
 */
export function holdingPositionAfter(trades: readonly TradeRecord[], upTo?: string): Position {
  const byMoney = trades.some((trade) => (trade.kind === 'buy' || trade.kind === 'sell') && (trade.unitsMicro <= 0 || trade.basisMinor != null));
  return byMoney ? moneyPositionAfter(trades, upTo) : positionAfter([...trades], upTo);
}
