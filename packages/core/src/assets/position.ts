import { divRound, formatUnits, priceMicroFrom } from './units';

export type TradeKind = 'buy' | 'sell' | 'income' | 'unit_change';

export interface TradeRecord {
  id: string;
  accountId: string;
  kind: TradeKind;
  /** Date the trade happened, YYYY-MM-DD. */
  occurredOn: string;
  createdAt: string;
  /** Units bought or sold, or the signed change for a unit change. */
  unitsMicro: number;
  /** Amount before fees and tax: what the units cost, the proceeds, or the income. */
  grossMinor: number;
  feeMinor: number;
  taxMinor: number;
}

export interface YearBucket {
  unitsMicro: number;
  costMinor: number;
}

export interface Position {
  unitsMicro: number;
  costMinor: number;
  realizedMinor: number;
  incomeMinor: number;
  /** Units and cost still held, by the year they were bought. Used by the Coretax per-year rows. */
  byYear: Record<string, YearBucket>;
}

export type TradeErrorCode = 'OVERSELL' | 'INVALID_UNITS' | 'INVALID_AMOUNT' | 'UNKNOWN_KIND' | 'CURRENCY_MISMATCH';

export class TradeError extends Error {
  readonly code: TradeErrorCode;

  constructor(code: TradeErrorCode, message: string) {
    super(message);
    this.name = 'TradeError';
    this.code = code;
  }
}

const emptyPosition = (): Position => ({ unitsMicro: 0, costMinor: 0, realizedMinor: 0, incomeMinor: 0, byYear: {} });

const byTradeOrder = (a: TradeRecord, b: TradeRecord) =>
  a.occurredOn.localeCompare(b.occurredOn) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/** Shares a whole out of buckets in proportion, giving the rounding difference to the largest bucket. */
function shareOut(buckets: YearBucket[], pick: (b: YearBucket) => number, set: (b: YearBucket, value: number) => void, total: number, target: number): void {
  if (buckets.length === 0) return;
  if (total <= 0) {
    for (const bucket of buckets) set(bucket, 0);
    return;
  }
  let given = 0;
  for (const bucket of buckets) {
    const value = Number(divRound(BigInt(pick(bucket)) * BigInt(target), BigInt(total)));
    set(bucket, value);
    given += value;
  }
  const largest = buckets.reduce((best, bucket) => (pick(bucket) > pick(best) ? bucket : best), buckets[0]!);
  set(largest, pick(largest) + (target - given));
}

/** Units and cost after walking every trade in date order. Sells take the average cost of all units held. */
export function positionAfter(trades: TradeRecord[], upTo?: string): Position {
  const position = emptyPosition();
  for (const trade of [...trades].sort(byTradeOrder)) {
    if (upTo && trade.occurredOn > upTo) continue;
    if (trade.grossMinor < 0 || trade.feeMinor < 0 || trade.taxMinor < 0) {
      throw new TradeError('INVALID_AMOUNT', 'Amounts on a trade cannot be negative');
    }
    const year = trade.occurredOn.slice(0, 4);
    const buckets = Object.values(position.byYear);
    if (trade.kind === 'buy') {
      if (trade.unitsMicro <= 0) throw new TradeError('INVALID_UNITS', 'A buy needs units greater than zero');
      const cost = trade.grossMinor + trade.feeMinor + trade.taxMinor;
      const bucket = (position.byYear[year] ??= { unitsMicro: 0, costMinor: 0 });
      position.unitsMicro += trade.unitsMicro;
      position.costMinor += cost;
      bucket.unitsMicro += trade.unitsMicro;
      bucket.costMinor += cost;
    } else if (trade.kind === 'sell') {
      if (trade.unitsMicro <= 0) throw new TradeError('INVALID_UNITS', 'A sell needs units greater than zero');
      const basis = sellBasisMinor(position, trade.unitsMicro);
      const unitsLeft = position.unitsMicro - trade.unitsMicro;
      const costLeft = position.costMinor - basis;
      shareOut(buckets, (b) => b.unitsMicro, (b, v) => { b.unitsMicro = v; }, position.unitsMicro, unitsLeft);
      shareOut(buckets, (b) => b.costMinor, (b, v) => { b.costMinor = v; }, position.costMinor, costLeft);
      position.unitsMicro = unitsLeft;
      position.costMinor = costLeft;
      position.realizedMinor += trade.grossMinor - trade.feeMinor - trade.taxMinor - basis;
    } else if (trade.kind === 'income') {
      position.incomeMinor += trade.grossMinor - trade.taxMinor;
    } else if (trade.kind === 'unit_change') {
      const unitsAfter = position.unitsMicro + trade.unitsMicro;
      if (unitsAfter < 0) throw new TradeError('INVALID_UNITS', 'A unit change cannot leave fewer than zero units');
      shareOut(buckets, (b) => b.unitsMicro, (b, v) => { b.unitsMicro = v; }, position.unitsMicro, unitsAfter);
      position.unitsMicro = unitsAfter;
    } else {
      throw new TradeError('UNKNOWN_KIND', `Unknown trade kind "${String((trade as TradeRecord).kind)}"`);
    }
  }
  for (const [year, bucket] of Object.entries(position.byYear)) {
    if (bucket.unitsMicro <= 0 && bucket.costMinor <= 0) delete position.byYear[year];
  }
  return position;
}

/** Cost of the units being sold, at the average cost of everything held. A full sell takes the rest. */
export function sellBasisMinor(position: Position, unitsMicro: number): number {
  if (unitsMicro <= 0) throw new TradeError('INVALID_UNITS', 'A sell needs units greater than zero');
  if (unitsMicro > position.unitsMicro) {
    throw new TradeError('OVERSELL', `You hold ${formatUnits(position.unitsMicro)}; enter up to ${formatUnits(position.unitsMicro)}`);
  }
  if (unitsMicro === position.unitsMicro) return position.costMinor;
  return Number(divRound(BigInt(position.costMinor) * BigInt(unitsMicro), BigInt(position.unitsMicro)));
}

/** Average cost per unit, in millionths of a minor unit, or null when nothing is held. */
export function averagePriceMicro(position: Position): number | null {
  if (position.unitsMicro <= 0) return null;
  return priceMicroFrom(position.costMinor, position.unitsMicro);
}
