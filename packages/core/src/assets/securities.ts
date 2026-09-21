import { inflowTo, outflowFrom } from '../goals/set-aside';
import { currencyInfo } from '../money/currencies';
import { sumToBase } from '../money/exchange';
import { convertMinor } from '../money/money';
import { type Position, positionAfter, type TradeRecord } from './position';
import { type TradeAccounts, type TradeInput, tradePostings } from './trades';
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
  /**
   * The same cost in base, each buy at its own day's rate (`positionInBase`) — or null when a foreign holding has no
   * pinned base cost. Unknown is carried as unknown, never counted as zero.
   */
  costBaseMinor: number | null;
}

export interface PortfolioSummary {
  /** Today's value in base (`sumToBase`), or null when a rate is missing — never the sum of the rest. */
  valueBaseMinor: number | null;
  /** What was put in, in base: each buy pinned on its own day, so it needs no rate today. Null when any holding's is unknown. */
  costBaseMinor: number | null;
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
  // Signed, and in base already: nothing here needs a rate. One unknown cost makes the whole unknown, never a zero.
  const costBaseMinor = holdings.some((h) => h.costBaseMinor === null) ? null : holdings.reduce((sum, h) => sum + h.costBaseMinor!, 0);
  // The move is the foreign holdings at today's rate (sumToBase again) less the same holdings at the rate each was bought at.
  const foreign = holdings.filter((h) => h.currency !== base && h.costMinor > 0);
  const today = sumToBase({ amounts: foreign.map((h) => ({ minor: h.valueMinor, currency: h.currency })), baseCurrency: base, ratesToBase });
  const atCostRates = costBaseMinor === null ? null : foreign.reduce((sum, h) => sum + divRound(BigInt(h.valueMinor) * BigInt(h.costBaseMinor!), BigInt(h.costMinor)), 0n);
  const valueBaseMinor = value.totalMinor;
  const known = valueBaseMinor !== null && costBaseMinor !== null;
  return {
    valueBaseMinor,
    costBaseMinor,
    gainBaseMinor: known ? valueBaseMinor - costBaseMinor : null,
    gainBps: known ? gainBps(valueBaseMinor, costBaseMinor) : null,
    currencyMoveMinor: today.totalMinor === null || valueBaseMinor === null || atCostRates === null ? null : today.totalMinor - Number(atCostRates),
    converted: holdings.some((h) => h.currency !== base && h.valueMinor !== 0),
    missingRates: value.missing,
  };
}

export interface TradeRateNeeds {
  /** The form asks what left or reached the cash account, in its own currency. */
  charged: boolean;
  /** The currency whose rate is worked out from the two amounts, when one side is the base. */
  derived: string | null;
  /** Currencies that need the day's rate from `resolveRates` (or typed when it has none). */
  dayRates: string[];
}

export function tradeRateNeeds(holding: string, cash: string, base: string): TradeRateNeeds {
  if (holding === cash) return { charged: false, derived: null, dayRates: holding === base ? [] : [holding] };
  if (cash === base) return { charged: true, derived: holding, dayRates: [] };
  if (holding === base) return { charged: true, derived: cash, dayRates: [] };
  return { charged: true, derived: null, dayRates: [holding, cash].sort() };
}

/** Base per one major unit of `currency`, from what the same money was in each. Used for that trade only. */
export function rateFromAmounts(amountMinor: number, currency: string, baseMinor: number, base: string): number {
  if (!(amountMinor > 0) || !(baseMinor > 0)) throw new Error('Both amounts must be more than zero to work out a rate');
  return baseMinor / 10 ** currencyInfo(base).exponent / (amountMinor / 10 ** currencyInfo(currency).exponent);
}

/** Stand-ins for `tradePostings`: one currency on both sides, so it posts the cash line in the holding's currency. */
const CASH = '\u0000cash';
const ONE_CURRENCY: TradeAccounts = {
  holdingAccountId: '\u0000holding',
  holdingCurrency: 'XXX',
  cashAccountId: CASH,
  cashCurrency: 'XXX',
  realizedGainsCategoryId: '\u0000gains',
  investmentIncomeCategoryId: '\u0000income',
  finalTaxCategoryId: '\u0000tax',
};

/**
 * What moves through the cash account, in the holding's currency: the cash line `tradePostings` itself posts, read
 * back with `outflowFrom` / `inflowTo` — so a change to how a trade posts can never leave this figure behind. A sell
 * is posted against a position that holds exactly what it sells; its basis never touches the cash line.
 */
export function tradeCashMinor(input: TradeInput): number {
  if (input.kind === 'unit_change') return 0;
  const held = { unitsMicro: input.unitsMicro, costMinor: 0, realizedMinor: 0, incomeMinor: 0, byYear: {} };
  const lines = tradePostings({ ...input, cashMinor: undefined }, held, ONE_CURRENCY);
  return input.kind === 'buy' ? outflowFrom(lines, CASH) : inflowTo(lines, CASH);
}

/**
 * What moved through the cash account either way, in the holding's currency: what left for a buy, what reached it for a
 * sell or an income — or, for a sell whose fees and tax passed its proceeds, the shortfall that left it. Zero when the
 * fees ate the proceeds exactly: nothing moved, so there is no amount in the cash currency and no rate to work out.
 */
export function tradeCashMovedMinor(input: TradeInput): number {
  if (input.kind === 'unit_change') return 0;
  const held = { unitsMicro: input.unitsMicro, costMinor: 0, realizedMinor: 0, incomeMinor: 0, byYear: {} };
  const lines = tradePostings({ ...input, cashMinor: undefined }, held, ONE_CURRENCY);
  return outflowFrom(lines, CASH) + inflowTo(lines, CASH);
}

/** One major unit of `currency` in base minor units — "Rp 15.800" per dollar. */
export function perUnitInBase(rate: number, currency: string, base: string): number {
  return convertMinor(10 ** currencyInfo(currency).exponent, currency, base, rate);
}

/** The daftar harta's name for a holding (C2). The tax report is the one Indonesian screen, so "Saham" is its word. */
export function taxHoldingName(
  security: { ticker: string | null; name: string; kind: SecurityKind } | null,
  brokerName: string | null,
  accountName: string,
): string {
  if (!security) return accountName;
  const what = security.kind === 'share' && security.ticker ? `Saham ${security.ticker}` : security.name;
  return brokerName ? `${what} — ${brokerName}` : what;
}
