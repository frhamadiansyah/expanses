import { convertMinor, formatUnits, parseMajor, parseRate, tradeCashMovedMinor } from '@expanses/core';
import type { RecordTradeInput } from '@expanses/db';
import { type PartDraft, partsFromTyped, SPLIT } from './goal-parts-form';
import { typedAmount } from './trade-form';

/**
 * What the short Buy / Sell sheets keep behind "Add more details": the rows the full form has and a dealer's receipt
 * rarely needs — a fee, tax withheld, the goal, and the rate that day when the money is in another currency. Kept
 * while folded away, so folding never loses what was typed: the save always sends it.
 */
export interface TradeDetailsDraft {
  fee: string;
  tax: string;
  /** Empty is no goal; `SPLIT` means `parts`, as on the full form. */
  goalId: string;
  parts: PartDraft[];
  /** The rate between the holding's currency and the money account's, one `pairRate().from` in `.to`. */
  rate: string;
  /** A day rate the save could not find, typed under it as the full form's own "Rate that day". */
  dayRate: string;
  /** A buy paid by credit card: the purchase category (so points count) and the merchant code. */
  spendCategoryId: string;
  mcc: string;
}

export const emptyTradeDetails = (): TradeDetailsDraft => ({ fee: '', tax: '', goalId: '', parts: [], rate: '', dayRate: '', spendCategoryId: '', mcc: '' });

/**
 * Which way "Rate that day" reads when the money account's currency is not the holding's: one `from` is so many
 * `to`. With either side in the workspace's currency it is that currency per one of the other — as every rate in the
 * app reads; with neither, the account's currency per one of the holding's. Null when both are the same currency.
 */
export function pairRate(holding: string, cash: string, base: string): { from: string; to: string } | null {
  if (holding === cash) return null;
  if (cash === base) return { from: holding, to: base };
  if (holding === base) return { from: cash, to: base };
  return { from: holding, to: cash };
}

/** What moved, in the holding's currency, as the money account's own currency at the typed pair rate. */
export function cashAtRate(movedMinor: number, holding: string, cash: string, base: string, rate: number): number {
  const pair = pairRate(holding, cash, base);
  if (!pair) return movedMinor;
  return convertMinor(movedMinor, holding, cash, pair.from === holding ? rate : 1 / rate);
}

/** A typed fee or tax in minor units: empty is `fallback`. Throws, in the screen's words, on anything else. */
export function detailMinor(text: string, currency: string, label: string, fallback = 0): number {
  if (text.trim() === '') return fallback;
  let minor: number;
  try {
    minor = parseMajor(text, currency);
  } catch {
    throw new Error(`${label} must be an amount`);
  }
  if (minor < 0) throw new Error(`${label} cannot be below zero`);
  return minor;
}

/**
 * The sheet's trade with its details on it, exactly as the full form would send it (`draftToInput`, `withCharged`): the
 * fee and tax, the goal or the split between goals, and — the money in another currency — what moved through the
 * account at the typed rate, as `cashMinor`. Throws, in the screen's words, when a detail cannot be read.
 *
 * An empty Fee or Tax withheld keeps the figure the sheet already put on the trade: nothing, or a listed share's worked-out charge.
 */
export function withDetails(
  input: RecordTradeInput,
  details: TradeDetailsDraft,
  o: { holdingCurrency: string; cashCurrency: string; baseCurrency: string; byMoney: boolean; /** The money account is a credit card. */ card?: boolean },
): RecordTradeInput {
  const feeMinor = detailMinor(details.fee, o.holdingCurrency, 'Fee', input.feeMinor);
  const taxMinor = detailMinor(details.tax, o.holdingCurrency, 'Tax withheld', input.taxMinor);
  const goal =
    details.goalId === SPLIT
      ? {
          goalId: null,
          goalParts: partsFromTyped(
            details.parts,
            o.byMoney ? typedAmount(input.grossMinor, o.holdingCurrency) : formatUnits(input.unitsMicro),
            o.byMoney,
            o.holdingCurrency,
          ),
        }
      : { goalId: details.goalId || null };
  const points = o.card && input.kind === 'buy' ? { spendCategoryId: details.spendCategoryId || null, mcc: details.mcc.trim() || null } : {};
  const out: RecordTradeInput = { ...input, feeMinor, taxMinor, ...goal, ...points };

  const pair = pairRate(o.holdingCurrency, o.cashCurrency, o.baseCurrency);
  if (!pair || input.kind === 'unit_change') return out;
  const moved = tradeCashMovedMinor(out);
  // A sell whose fee and tax took all of it: nothing reaches the account, so there is nothing to convert.
  if (moved === 0 && out.kind !== 'buy') return out;
  if (details.rate.trim() === '') throw new Error('Type the rate that day');
  let rate: number;
  try {
    rate = parseRate(details.rate);
  } catch {
    throw new Error('Rate that day must be a number');
  }
  if (!(rate > 0)) throw new Error('Rate that day must be more than zero');
  const cashMinor = cashAtRate(moved, o.holdingCurrency, o.cashCurrency, o.baseCurrency, rate);
  if (!(cashMinor > 0)) throw new Error('Rate that day is too small for this amount');
  return { ...out, cashMinor };
}

