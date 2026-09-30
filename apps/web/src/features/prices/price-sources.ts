import { isIdxListing, type ListedPriceChoice, listedPriceChoice, type PriceSource, yahooSymbol } from '@expanses/core';
import { YAHOO_PRICES_ENABLED } from './yahoo-switch';

export { YAHOO_PRICES_ENABLED };

/** A security as the price source needs it. */
export interface PricedSecurity {
  ticker: string | null;
  market: string;
  currency: string;
}

/** The choice a security follows: what was saved, or the default, with Yahoo only while the switch is on. */
export function listedChoiceOf(security: PricedSecurity, stored: ListedPriceChoice | null, yahoo: boolean = YAHOO_PRICES_ENABLED): ListedPriceChoice {
  return listedPriceChoice(stored, { yahoo, yahooSymbol: yahooSymbol(security) !== null, idx: isIdxListing(security) });
}

export interface SourceOption {
  choice: ListedPriceChoice;
  label: string;
  detail: string;
}

/** The answers the Price source sheet offers a security: Yahoo only while switched on and able to price it, IDX's file only for an IDX share. */
export function listedSourceOptions(security: PricedSecurity, yahoo: boolean = YAHOO_PRICES_ENABLED): SourceOption[] {
  return [
    ...(yahoo && yahooSymbol(security) ? [{ choice: 'yahoo' as const, label: 'Yahoo Finance', detail: 'Daily close, fetched automatically · delayed' }] : []),
    ...(isIdxListing(security) ? [{ choice: 'idx' as const, label: 'IDX daily file', detail: 'Updated when you import IDX’s Ringkasan Saham file' }] : []),
    { choice: 'typed', label: "I'll type it", detail: 'No automatic price' },
  ];
}

/** What the Details row says for each choice. */
export const CHOICE_LABELS: Record<ListedPriceChoice, string> = { yahoo: 'Yahoo Finance', idx: 'IDX daily file', typed: "I'll type it" };

/** Where a stored price came from, as its ⓘ and the Update prices list say it. */
export const SOURCE_LABELS: Record<PriceSource, string> = {
  manual: 'Typed',
  world: 'World price (XAU)',
  yahoo: 'Yahoo Finance close',
  idx: 'IDX closing price',
};
