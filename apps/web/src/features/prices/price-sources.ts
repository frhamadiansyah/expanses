import { type GoldPriceChoice, isIdxListing, type ListedPriceChoice, listedPriceChoice, type PriceSource, yahooSymbol } from '@expanses/core';
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

/** The words a Price source row uses. The IDX file's is not settled with the owner yet, so it is one constant. */
export const IDX_FILE_LABEL = 'Import';
export const AUTOMATIC_LABEL = 'Automatic';
export const MANUAL_LABEL = 'Manual';

/** The answers the Price source row offers a security: Yahoo only while switched on and able to price it, IDX's file only for an IDX share. */
export function listedSourceOptions(security: PricedSecurity, yahoo: boolean = YAHOO_PRICES_ENABLED): SourceOption[] {
  return [
    ...(yahoo && yahooSymbol(security) ? [{ choice: 'yahoo' as const, label: AUTOMATIC_LABEL, detail: 'daily close, fetched automatically, delayed' }] : []),
    ...(isIdxListing(security) ? [{ choice: 'idx' as const, label: IDX_FILE_LABEL, detail: 'updated when IDX’s Ringkasan Saham file is imported' }] : []),
    { choice: 'typed', label: MANUAL_LABEL, detail: 'no automatic price' },
  ];
}

/** The two answers a gold holding has. */
export const GOLD_SOURCES: { choice: GoldPriceChoice; label: string; detail: string }[] = [
  { choice: 'world', label: AUTOMATIC_LABEL, detail: 'daily world gold price, spot, not a buyback price' },
  { choice: 'typed', label: MANUAL_LABEL, detail: 'no automatic price' },
];

/** What the Price source row says for each choice. */
export const CHOICE_LABELS: Record<ListedPriceChoice, string> = { yahoo: AUTOMATIC_LABEL, idx: IDX_FILE_LABEL, typed: MANUAL_LABEL };

/** Where a stored price came from, as its ⓘ and the Update prices list say it. */
export const SOURCE_LABELS: Record<PriceSource, string> = {
  manual: 'Typed',
  world: 'World price (XAU)',
  yahoo: 'Yahoo Finance close',
  idx: 'IDX closing price',
};
