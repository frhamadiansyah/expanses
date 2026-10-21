import { currencyInfo } from '../money/currencies';
import { sumToBase } from '../money/exchange';
import type { YahooDividend } from '../prices/yahoo';
import { percentShares } from './securities';

/*
 * The Dividends page's figures: what the shares held today pay in a year, what this year has paid and still owes,
 * the yield on what was put in and on what it is worth, and who pays it.
 *
 * Every figure is an estimate from each stock's own dividend history (Yahoo's ex-dividend days and amounts per share),
 * never a promise: a company sets its dividend each year. Amounts are before any tax.
 *
 * - A year: every dividend with an ex-date in the last 365 days, at the shares held now.
 * - Received this year: each ex-date from 1 January to today, at the shares held the day before it (the last day a
 *   buyer still qualifies).
 * - Still to come: last calendar year's payments that this year has not matched yet, in order, at the shares held now —
 *   a stock that paid twice last year and once so far this year still owes last year's second.
 * - By month: the year's dividends by the month of their ex-date.
 */

/** One stock held, with the history it pays by. */
export interface DividendHolding {
  securityId: string;
  title: string;
  currency: string;
  /** Units held now, every holding of the stock together. */
  unitsMicro: number;
  /** Units held at the end of a day, every holding together. */
  unitsOn: (date: string) => number;
  /** In base; null when it is not known. */
  costBaseMinor: number | null;
  valueBaseMinor: number | null;
  /** Oldest first; null when it could not be read (offline, refused), which the page names rather than counts as none. */
  payments: readonly YahooDividend[] | null;
}

export interface DividendPayer {
  securityId: string;
  title: string;
  yearMinor: number;
  /** Whole percent of the year, adding up to 100 across the payers. */
  percent: number;
}

export interface DividendMonth {
  /** 1 to 12. */
  month: number;
  minor: number;
  /** The stocks paying that month, largest first. */
  titles: string[];
}

export interface DividendView {
  /** All in base. */
  yearMinor: number;
  receivedMinor: number;
  toComeMinor: number;
  /** Months (1 to 12) still to pay this year, in order. */
  toComeMonths: number[];
  /** Basis points; null with nothing put in, or a cost not known. */
  yieldOnCostBps: number | null;
  yieldAtPriceBps: number | null;
  payers: DividendPayer[];
  months: DividendMonth[];
  /** Stocks left out: no history read, or no rate for their currency. */
  unknown: string[];
}

const DAY = 86_400_000;
const shiftDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** A dividend per share on some units, in the stock's minor units. */
function paidMinor(perShare: number, unitsMicro: number, currency: string): number {
  return Math.round((unitsMicro / 1_000_000) * perShare * 10 ** currencyInfo(currency).exponent);
}

const bpsOf = (part: number, whole: number | null) => (whole === null || whole <= 0 ? null : Math.round((part * 10_000) / whole));

export function dividendView(o: { holdings: readonly DividendHolding[]; today: string; baseCurrency: string; ratesToBase: Readonly<Record<string, number>> }): DividendView {
  const { today } = o;
  const yearAgo = shiftDays(today, -365);
  const thisYear = today.slice(0, 4);
  const lastYear = String(Number(thisYear) - 1);
  const toBase = (minor: number, currency: string) => sumToBase({ amounts: [{ minor, currency }], baseCurrency: o.baseCurrency, ratesToBase: o.ratesToBase }).totalMinor;

  let yearMinor = 0;
  let receivedMinor = 0;
  let toComeMinor = 0;
  const toComeMonths = new Set<number>();
  let cost: number | null = 0;
  let value: number | null = 0;
  const payers: Omit<DividendPayer, 'percent'>[] = [];
  const months = new Map<number, Map<string, number>>();
  const unknown: string[] = [];

  for (const holding of o.holdings) {
    if (holding.payments === null || toBase(1_000_000, holding.currency) === null) {
      unknown.push(holding.title);
      continue;
    }
    const inBase = (minor: number) => toBase(minor, holding.currency) ?? 0;
    let year = 0;
    for (const p of holding.payments) {
      if (p.exDate <= yearAgo || p.exDate > today) continue;
      const minor = inBase(paidMinor(p.perShare, holding.unitsMicro, holding.currency));
      year += minor;
      const month = Number(p.exDate.slice(5, 7));
      const byTitle = months.get(month) ?? new Map<string, number>();
      byTitle.set(holding.title, (byTitle.get(holding.title) ?? 0) + minor);
      months.set(month, byTitle);
    }
    const paidThisYear = holding.payments.filter((p) => p.exDate.startsWith(thisYear) && p.exDate <= today);
    for (const p of paidThisYear) receivedMinor += inBase(paidMinor(p.perShare, holding.unitsOn(shiftDays(p.exDate, -1)), holding.currency));
    for (const p of holding.payments.filter((p) => p.exDate.startsWith(lastYear)).slice(paidThisYear.length)) {
      toComeMinor += inBase(paidMinor(p.perShare, holding.unitsMicro, holding.currency));
      toComeMonths.add(Number(p.exDate.slice(5, 7)));
    }
    yearMinor += year;
    if (year > 0) payers.push({ securityId: holding.securityId, title: holding.title, yearMinor: year });
    cost = cost === null || holding.costBaseMinor === null ? null : cost + holding.costBaseMinor;
    value = value === null || holding.valueBaseMinor === null ? null : value + holding.valueBaseMinor;
  }

  payers.sort((a, b) => b.yearMinor - a.yearMinor || a.title.localeCompare(b.title));
  const percents = percentShares(payers.map((p) => p.yearMinor));
  return {
    yearMinor,
    receivedMinor,
    toComeMinor,
    toComeMonths: [...toComeMonths].sort((a, b) => a - b),
    yieldOnCostBps: bpsOf(yearMinor, cost),
    yieldAtPriceBps: bpsOf(yearMinor, value),
    payers: payers.map((p, i) => ({ ...p, percent: percents[i]! })),
    months: Array.from({ length: 12 }, (_, i) => {
      const byTitle = [...(months.get(i + 1) ?? new Map<string, number>())].sort((a, b) => b[1] - a[1]);
      return { month: i + 1, minor: byTitle.reduce((sum, [, m]) => sum + m, 0), titles: byTitle.map(([title]) => title) };
    }),
    unknown,
  };
}
