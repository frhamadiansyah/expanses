import { sumToBase } from '../money/exchange';
import { type Position, positionAfter, type TradeRecord } from './position';
import { divRound } from './units';

/** A share with a ticker, an exchange-traded fund, or anything else (an unlisted share, a private fund). */
export type SecurityKind = 'share' | 'etf' | 'other';

/**
 * A holding's position with its cost in the base currency: each buy at the base amount the ledger pinned on its
 * own day, walked exactly as `positionAfter` walks it — a sell takes its average share, per-year buckets are shared
 * out with the difference to the largest. Units are the same units. Realised gains and income are not base facts
 * here and read as nothing; nothing may read them from this position.
 */
export function positionInBase(trades: readonly TradeRecord[], baseCostOfBuy: Readonly<Record<string, number>>, upTo?: string): Position {
  const walked: TradeRecord[] = [];
  for (const trade of trades) {
    if (upTo && trade.occurredOn > upTo) continue;
    if (trade.kind === 'income') continue;
    if (trade.kind === 'buy') {
      const base = baseCostOfBuy[trade.id];
      if (base === undefined) throw new Error(`No base-currency cost for buy ${trade.id}`);
      walked.push({ ...trade, grossMinor: base, feeMinor: 0, taxMinor: 0 });
    } else {
      walked.push({ ...trade, grossMinor: 0, feeMinor: 0, taxMinor: 0 });
    }
  }
  return { ...positionAfter(walked, upTo), realizedMinor: 0, incomeMinor: 0 };
}

/** Whole percentages of a total that add up to exactly 100: each part floored, the remainder to the largest part. */
export function percentShares(parts: readonly number[]): number[] {
  if (parts.some((part) => part < 0)) throw new Error('A share of a whole cannot be negative');
  const total = parts.reduce((sum, part) => sum + part, 0);
  if (parts.length === 0 || total <= 0) return parts.map(() => 0);
  const shares = parts.map((part) => Number((BigInt(part) * 100n) / BigInt(total)));
  let largest = 0;
  parts.forEach((part, i) => {
    if (part > parts[largest]!) largest = i;
  });
  shares[largest] = shares[largest]! + (100 - shares.reduce((sum, share) => sum + share, 0));
  return shares;
}

/** Gain as signed basis points of cost, half away from zero. Null when nothing was paid. */
export function gainBps(valueMinor: number, costMinor: number): number | null {
  if (costMinor <= 0) return null;
  return Number(divRound(BigInt(valueMinor - costMinor) * 10_000n, BigInt(costMinor)));
}

/** "+9,8%": one decimal, half away from zero, a real minus sign. */
export function formatBps(bps: number, locale = 'id-ID'): string {
  const tenths = Number(divRound(BigInt(bps), 10n));
  const sign = tenths > 0 ? '+' : tenths < 0 ? '−' : '';
  return `${sign}${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.abs(tenths) / 10)}%`;
}

export interface PortfolioHolding {
  currency: string;
  /** Today's value and the cost of what is held, both in the holding's own currency. */
  valueMinor: number;
  costMinor: number;
  /** The same cost in base, each buy at its own day's rate (`positionInBase`). */
  costBaseMinor: number;
}

export interface PortfolioSummary {
  /** Today's value in base (`sumToBase`), or null when a rate is missing — never the sum of the rest. */
  valueBaseMinor: number | null;
  /** What was put in, in base: each buy pinned on its own day, so it needs no rate today. */
  costBaseMinor: number;
  gainBaseMinor: number | null;
  gainBps: number | null;
  /** How much of the gain is the rate moving: today's rate against the rate each holding was bought at. Signed; null with the value. */
  currencyMoveMinor: number | null;
  /** True when a figure in it is (or would be) converted at today's rate, so the total carries ≈. */
  converted: boolean;
  /** Currencies with no rate today, exactly as `sumToBase` names them. */
  missingRates: string[];
}

export function portfolioSummary(holdings: readonly PortfolioHolding[], base: string, ratesToBase: Readonly<Record<string, number>>): PortfolioSummary {
  const value = sumToBase({ amounts: holdings.map((h) => ({ minor: h.valueMinor, currency: h.currency })), baseCurrency: base, ratesToBase });
  // Signed, and in base already: nothing here needs a rate.
  const costBaseMinor = holdings.reduce((sum, h) => sum + h.costBaseMinor, 0);
  // The move is the foreign holdings at today's rate (sumToBase again) less the same holdings at the rate each was bought at.
  const foreign = holdings.filter((h) => h.currency !== base && h.costMinor > 0);
  const today = sumToBase({ amounts: foreign.map((h) => ({ minor: h.valueMinor, currency: h.currency })), baseCurrency: base, ratesToBase });
  const atCostRates = foreign.reduce((sum, h) => sum + divRound(BigInt(h.valueMinor) * BigInt(h.costBaseMinor), BigInt(h.costMinor)), 0n);
  const valueBaseMinor = value.totalMinor;
  return {
    valueBaseMinor,
    costBaseMinor,
    gainBaseMinor: valueBaseMinor === null ? null : valueBaseMinor - costBaseMinor,
    gainBps: valueBaseMinor === null ? null : gainBps(valueBaseMinor, costBaseMinor),
    currencyMoveMinor: today.totalMinor === null || valueBaseMinor === null ? null : today.totalMinor - Number(atCostRates),
    converted: holdings.some((h) => h.currency !== base && h.valueMinor !== 0),
    missingRates: value.missing,
  };
}
