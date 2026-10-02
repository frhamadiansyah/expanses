import { INDONESIAN_BROKERS } from '../coretax/brokers';

/*
 * A buy or a sell of a share on IDX, the way a broker's app works one out: a price on IDX's tick, whole lots, the
 * broker's fee on what changed hands, and on a sell the 0,1% final tax the fee already includes. Pure arithmetic in
 * whole rupiah; the trade itself is recorded as any other (recordTrade).
 */

/** IDX's price steps, by the price a share trades at: 1, 2, 5, 10 and 25 rupiah. */
export function idxTickSize(price: number): number {
  if (price < 200) return 1;
  if (price < 500) return 2;
  if (price < 2_000) return 5;
  if (price < 5_000) return 10;
  return 25;
}

/** Whether a price is one IDX can trade at: a whole rupiah on its band's step. */
export function isIdxTick(price: number): boolean {
  return Number.isInteger(price) && price > 0 && price % idxTickSize(price) === 0;
}

/**
 * One step up or down from a price. A price between steps goes to the nearest step in that direction; a step down
 * from a band's edge takes the lower band's step (5.000 − 1 step is 4.990). Never below 1.
 */
export function stepIdxPrice(price: number, direction: 1 | -1): number {
  if (direction === 1) {
    const tick = idxTickSize(price);
    return isIdxTick(price) ? price + tick : Math.ceil(price / tick) * tick;
  }
  if (price <= 1) return 1;
  const below = Math.ceil(price) - 1;
  const tick = idxTickSize(below);
  return Math.max(1, Math.floor(below / tick) * tick);
}

/** A broker's charges: fees in parts per million of what changed hands, and an optional smallest fee in a day. */
export interface BrokerFees {
  buyPpm: number;
  /** A share's sell fee, the 0,1% final tax included. */
  sellPpm: number;
  /** The least the broker charges across a day's trades, in rupiah; null when it has none. */
  minDailyMinor: number | null;
}

/** IDX's final tax on a share sale: 0,1% of what it sold for (PP 41/1994), inside a broker's sell fee. */
export const IDX_SALE_TAX_PPM = 1_000;

/** What most brokers charge: 0,15% to buy, 0,25% to sell, no minimum. */
export const DEFAULT_BROKER_FEES: BrokerFees = { buyPpm: 1_500, sellPpm: 2_500, minDailyMinor: null };

const KNOWN_FEES: Record<string, BrokerFees> = {
  'Stockbit Sekuritas': { buyPpm: 1_500, sellPpm: 2_500, minDailyMinor: null },
  'Mandiri Sekuritas': { buyPpm: 1_800, sellPpm: 2_800, minDailyMinor: 5_000 },
  'Mirae Asset Sekuritas': { buyPpm: 1_500, sellPpm: 2_500, minDailyMinor: null },
};

/** The fees a broker starts with, by the name its cash account goes by ("Stockbit", "Mandiri Sekuritas"). */
export function brokerFeeDefaults(name: string): BrokerFees {
  const text = name.trim().toLowerCase();
  const words = new Set(text.split(/[^a-z0-9-]+/).filter(Boolean));
  // The firm's full name anywhere in it, or one of its short names as a word of it.
  const broker = INDONESIAN_BROKERS.find((entry) => text.includes(entry.name.toLowerCase()) || entry.also.some((short) => words.has(short.toLowerCase())));
  return (broker && KNOWN_FEES[broker.name]) ?? DEFAULT_BROKER_FEES;
}

/** A share of an amount in parts per million, to the whole rupiah, a half rounded up. */
export function ppmOf(amountMinor: number, ppm: number): number {
  return Number((BigInt(amountMinor) * BigInt(ppm) + 500_000n) / 1_000_000n);
}

export interface IdxCharge {
  /** The broker's fee, the final tax taken out of it. */
  feeMinor: number;
  /** The final tax on a sale; 0 on a buy and on an ETF sale. */
  taxMinor: number;
  /** The rate the fee was worked at. */
  ratePpm: number;
  /** True when the day's minimum, not the rate, set the fee. */
  minimumApplied: boolean;
  /** A buy's total cost, or what a sale leaves in the account. */
  totalMinor: number;
}

/**
 * What a trade costs or leaves. The fee is the rate on what changed hands, or — when the broker has a daily minimum —
 * whatever more it takes for the day's fees together (`chargedTodayMinor`, fee and tax of the trades already recorded
 * there that day) to reach it; never less than the rate. A share sale's fee includes the 0,1% final tax, which is
 * recorded as the trade's tax; an ETF (and a right or a warrant) pays no final tax, so its sell rate is 0,1% less.
 */
export function idxCharge(o: { kind: 'buy' | 'sell'; grossMinor: number; fees: BrokerFees; etf: boolean; chargedTodayMinor: number }): IdxCharge {
  const taxFree = o.kind === 'sell' && o.etf;
  const ratePpm = o.kind === 'buy' ? o.fees.buyPpm : taxFree ? Math.max(0, o.fees.sellPpm - IDX_SALE_TAX_PPM) : o.fees.sellPpm;
  const byRate = ppmOf(o.grossMinor, ratePpm);
  const topUp = o.fees.minDailyMinor === null ? 0 : Math.max(0, o.fees.minDailyMinor - o.chargedTodayMinor);
  const charged = Math.max(byRate, topUp);
  const taxMinor = o.kind === 'sell' && !taxFree ? Math.min(charged, ppmOf(o.grossMinor, IDX_SALE_TAX_PPM)) : 0;
  const feeMinor = charged - taxMinor;
  return {
    feeMinor,
    taxMinor,
    ratePpm,
    minimumApplied: topUp > byRate,
    totalMinor: o.kind === 'buy' ? o.grossMinor + charged : o.grossMinor - charged,
  };
}

/** A rate in parts per million as a percentage, as the app writes one: 1.500 is "0,15%". */
export function ppmPercent(ppm: number): string {
  return `${(ppm / 10_000).toLocaleString('id-ID', { maximumFractionDigits: 4 })}%`;
}

/** A typed percentage ("0,15", "0.15%") in parts per million; throws on anything that is not one. */
export function parsePercentPpm(typed: string): number {
  const text = typed.trim().replace('%', '').replace(',', '.');
  if (!/^\d+(\.\d{1,4})?$/.test(text)) throw new Error('Type a percentage, like 0,15');
  const ppm = Math.round(Number(text) * 10_000);
  if (ppm > 100_000) throw new Error('A fee is under 10%');
  return ppm;
}
