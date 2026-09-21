import type { AssetKind } from '../assets/presets';
import type { TradeRecord } from '../assets/position';

/**
 * What a year's holdings paid, for the income attachment of the SPT.
 *
 * The app reports what was earned and what was withheld. It does not work out what is owed: the rates
 * differ by instrument and by year, and a figure that looks authoritative but is wrong is worse than
 * no figure at all. Which line of which form each row belongs on is the owner's to decide, with their
 * KPP if they are unsure.
 */

export type IncomeKind = 'dividend' | 'coupon' | 'distribution' | 'interest' | 'sale' | 'other';

/**
 * Which part of the return the income belongs to. Null until the owner says: an ORI coupon is final, a
 * corporate coupon is final, a foreign bond's is not, and a dividend is final unless it was reinvested.
 * Nothing about the kind of holding decides that, so nothing here guesses it.
 */
export type IncomeTreatment = 'final' | 'not_object' | 'ordinary';

export interface IncomeHolding {
  accountId: string;
  name: string;
  assetKind: AssetKind;
  /** The holding's own currency. Anything but the base currency is not taxed as final income here. */
  currency: string;
  /** How its income is taxed, as the owner set it. Null means not set. */
  treatment?: IncomeTreatment | null;
}

export interface ReinvestedInto {
  accountId: string;
  name: string;
  amountMinor: number;
}

export interface IncomeRow {
  accountId: string;
  name: string;
  kind: IncomeKind;
  grossMinor: number;
  /** Tax the issuer or broker already took. Zero where nothing was withheld or nothing was recorded. */
  taxMinor: number;
  /** Held abroad: not final tax, and worked out differently. Flagged rather than calculated. */
  foreign: boolean;
  treatment: IncomeTreatment | null;
  /** Where a reinvested dividend was declared to have gone, for the Laporan Realisasi Investasi. */
  reinvestedInto: ReinvestedInto[];
}

export interface IncomeInput {
  /** Active trades only; a replaced or deleted one is not income. */
  trades: TradeRecord[];
  holdings: IncomeHolding[];
  year: number;
  baseCurrency: string;
}

/** A payment's name follows what pays it: shares pay dividends, bonds coupons, funds distributions. */
function kindOf(trade: TradeRecord, holding: IncomeHolding | undefined): IncomeKind {
  if (trade.kind === 'sell') return 'sale';
  switch (holding?.assetKind) {
    case 'stock':
      return 'dividend';
    case 'bond':
      return 'coupon';
    case 'fund':
      return 'distribution';
    // A deposit or a bank account: what it pays is interest.
    case 'cash':
      return 'interest';
    default:
      return 'other';
  }
}

export function investmentIncomeFor(input: IncomeInput): IncomeRow[] {
  const holdingOf = new Map(input.holdings.map((holding) => [holding.accountId, holding]));
  const from = `${input.year}-01-01`;
  const to = `${input.year}-12-31`;

  const rows = new Map<string, IncomeRow>();
  const rowFor = (trade: (typeof input.trades)[number], kind: IncomeKind, treatment: IncomeTreatment | null): IncomeRow => {
    const holding = holdingOf.get(trade.accountId);
    const key = `${trade.accountId}:${kind}:${treatment ?? 'unset'}`;
    const existing = rows.get(key);
    if (existing) return existing;
    const fresh: IncomeRow = {
      accountId: trade.accountId,
      name: holding?.name ?? trade.accountId,
      kind,
      grossMinor: 0,
      taxMinor: 0,
      foreign: holding !== undefined && holding.currency !== input.baseCurrency,
      treatment,
      reinvestedInto: [],
    };
    rows.set(key, fresh);
    return fresh;
  };

  for (const trade of input.trades) {
    if (trade.kind !== 'income' && trade.kind !== 'sell') continue;
    if (trade.occurredOn < from || trade.occurredOn > to) continue;

    const holding = holdingOf.get(trade.accountId);
    const kind = kindOf(trade, holding);
    // Only a payment can be reinvested. Proceeds from a sale are not a dividend, whatever is recorded.
    const declared = trade.kind === 'income' ? Math.max(0, Math.min(trade.reinvestedMinor ?? 0, trade.grossMinor)) : 0;

    if (declared > 0) {
      const row = rowFor(trade, kind, 'not_object');
      row.grossMinor += declared;
      const into = trade.reinvestedIntoAccountId ? holdingOf.get(trade.reinvestedIntoAccountId) : undefined;
      if (trade.reinvestedIntoAccountId) {
        row.reinvestedInto.push({
          accountId: trade.reinvestedIntoAccountId,
          name: into?.name ?? trade.reinvestedIntoAccountId,
          amountMinor: declared,
        });
      }
    }

    // What was not reinvested stays where the holding says, and carries all the tax that was withheld.
    const rest = trade.grossMinor - declared;
    if (rest !== 0 || trade.taxMinor !== 0) {
      const row = rowFor(trade, kind, holding?.treatment ?? null);
      row.grossMinor += rest;
      row.taxMinor += trade.taxMinor;
    }
  }

  // In the order the holdings are listed, so the report reads the way the assets page does.
  const order = new Map(input.holdings.map((holding, index) => [holding.accountId, index]));
  return [...rows.values()]
    .filter((row) => row.grossMinor !== 0 || row.taxMinor !== 0)
    .sort((a, b) => (order.get(a.accountId) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.accountId) ?? Number.MAX_SAFE_INTEGER) || a.kind.localeCompare(b.kind));
}
