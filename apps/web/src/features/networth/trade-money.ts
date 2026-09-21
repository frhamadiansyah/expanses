import { convertMinor, isoDate, parseMajor, rateFromAmounts, tradeCashMinor, tradeCashMovedMinor, tradeRateNeeds } from '@expanses/core';
import type { Database, RecordTradeInput, WorkspaceContext } from '@expanses/db';
import { openingRateFor } from '../../lib/rates';

const chargedHere = (currency: string) => `Enter the amount in ${currency} under “Charged in ${currency}”`;

/** A sell (or income) whose fees and tax took exactly what it brought: no money moves through the cash account. */
const nothingMoves = (input: RecordTradeInput) => input.kind !== 'buy' && input.kind !== 'unit_change' && tradeCashMovedMinor(input) === 0;

const isZero = (typed: string, currency: string) => {
  try {
    return parseMajor(typed, currency) === 0;
  } catch {
    return false;
  }
};

/**
 * What left (or reached) a paying account in another currency, put on the trade itself as `cashMinor` — so the
 * set-aside door (`tradeDoor`), the question it asks and the save all read the one figure. Read by `parseMajor`; a
 * one-currency trade and a unit change are returned as they came.
 */
export function withCharged(input: RecordTradeInput, charged: string, holdingCurrency: string, cashCurrency: string): RecordTradeInput {
  if (input.kind === 'unit_change' || holdingCurrency === cashCurrency) return input;
  if (nothingMoves(input)) {
    // A sell whose fees ate the proceeds: nothing reaches the account, so there is no amount to ask — the fees still post.
    const { cashMinor: _none, ...rest } = input;
    if (charged.trim() !== '' && !isZero(charged, cashCurrency)) throw new Error(`Nothing reaches the account — the fees take all of the sale — so leave Charged in ${cashCurrency} empty`);
    return rest;
  }
  if (charged.trim() === '') throw new Error(chargedHere(cashCurrency));
  let cashMinor: number;
  try {
    cashMinor = parseMajor(charged, cashCurrency);
  } catch {
    throw new Error(`Charged in ${cashCurrency} must be a number`);
  }
  if (!(cashMinor > 0)) throw new Error(`Charged in ${cashCurrency} must be more than zero`);
  return { ...input, cashMinor };
}

/**
 * The rates a trade posts with (spec §5.2) — the one place all three trade forms get them. One side in base: the rate
 * is the ratio of the two amounts (`tradeCashMinor` is what the holding side moves, read off `tradePostings`), used
 * for this trade only and never stored. Otherwise each day rate comes from `openingRateFor`: a rate typed under
 * `where` is checked and stored as the day's manual rate, exactly as every form that opens money does; none typed,
 * the day is resolved, and a missing one is named and asked for.
 */
export async function tradeRatesForSave(p: {
  database: Database;
  ws: WorkspaceContext;
  input: RecordTradeInput;
  holdingCurrency: string;
  /** The paying or receiving account's currency; the holding's own for an opening position. */
  cashCurrency: string;
  needsRate: string | null;
  manualRate: string;
  resolveRates: (currencies: string[], onDate: string) => Promise<{ rates: Record<string, number> }>;
  onMissing: (currency: string) => void;
  where: string;
}): Promise<Record<string, number>> {
  if (p.input.kind === 'unit_change') return {};
  const base = p.ws.baseCurrency;
  // Nothing reaching the account posts no cash line, so only the holding's own lines need a rate: its day rate.
  const needs = tradeRateNeeds(p.holdingCurrency, nothingMoves(p.input) ? p.holdingCurrency : p.cashCurrency, base);
  if (needs.charged && p.input.cashMinor === undefined) throw new Error(chargedHere(p.cashCurrency));
  const ratesToBase: Record<string, number> = {};

  if (needs.derived) {
    // What moved either way — a sell whose fees passed its proceeds moved the shortfall out.
    const moved = tradeCashMovedMinor(p.input);
    ratesToBase[needs.derived] =
      needs.derived === p.holdingCurrency
        ? rateFromAmounts(moved, p.holdingCurrency, p.input.cashMinor!, base)
        : rateFromAmounts(p.input.cashMinor!, p.cashCurrency, moved, base);
  }

  const onDate = p.input.occurredOn > isoDate() ? isoDate() : p.input.occurredOn;
  for (const currency of needs.dayRates) {
    const typed = p.needsRate === currency ? p.manualRate : '';
    try {
      // `openingBalanceMinor` only has to be non-zero here: the rate does not depend on the amount.
      const rate = await openingRateFor({ database: p.database, ws: p.ws, currency, openedOn: onDate, openingBalanceMinor: p.input.grossMinor, typed, resolveRates: p.resolveRates });
      // Undefined only when nothing was paid: a trade that moves no money posts no line to need a rate.
      if (rate !== undefined) ratesToBase[currency] = rate;
    } catch (error) {
      if (typed.trim()) throw error; // the typed rate's own refusal: not a number, or ten times off
      p.onMissing(currency);
      throw new Error(`No ${currency}→${base} rate for ${onDate}. Type it under “${p.where}”.`);
    }
  }
  return ratesToBase;
}

/**
 * The read-only "Rate that day" and "Cost in {base}" rows, from the very input the save will send: a buy's whole cost
 * (fee and tax included — what the holding line posts), at the rate the save will work out or the day rate this
 * device already holds (`useHeldRates`). Null when it cannot be known; never a guess.
 */
export function baseCostPreview(p: {
  input: RecordTradeInput | null;
  holdingCurrency: string;
  cashCurrency: string;
  baseCurrency: string;
  heldRates: Readonly<Record<string, number>>;
}): { rate: number | null; baseMinor: number | null } {
  const nothing = { rate: null, baseMinor: null };
  if (!p.input || p.input.kind !== 'buy') return nothing;
  const cost = tradeCashMinor(p.input);
  if (p.holdingCurrency === p.baseCurrency) return { rate: null, baseMinor: cost };
  const needs = tradeRateNeeds(p.holdingCurrency, p.cashCurrency, p.baseCurrency);
  if (needs.derived === p.holdingCurrency) {
    if (p.input.cashMinor === undefined) return nothing;
    return { rate: rateFromAmounts(cost, p.holdingCurrency, p.input.cashMinor, p.baseCurrency), baseMinor: p.input.cashMinor };
  }
  const rate = p.heldRates[p.holdingCurrency];
  if (rate === undefined) return nothing;
  return { rate, baseMinor: convertMinor(cost, p.holdingCurrency, p.baseCurrency, rate) };
}
