import type { WordList } from '../types';
import { EN } from './en';
import { ID } from './id';

/**
 * The words of every language, as one list.
 *
 * A capture does not say which language it is in, and it does not have to: the direction words of one language are
 * not words of another, so a merged list reads both and misreads neither. Longer words come first inside each list,
 * so a caller matching them in order matches "total pembayaran" before "total".
 */
export function mergeWords(...lists: readonly WordList[]): WordList {
  const merged: WordList = {
    spent: [],
    received: [],
    topup: [],
    refund: [],
    notDirection: [],
    promo: [],
    balance: [],
    amountLabels: [],
    nameLabels: [],
    nameLeadIns: [],
    paymentLabels: [],
    cardWords: [],
    idLabels: [],
    thousand: [],
    million: [],
  };
  for (const key of Object.keys(merged) as (keyof WordList)[]) {
    const seen = new Set<string>();
    for (const list of lists) {
      for (const word of list[key]) {
        const folded = word.toLowerCase();
        if (seen.has(folded)) continue;
        seen.add(folded);
        merged[key].push(folded);
      }
    }
    merged[key].sort((a, b) => b.length - a.length);
  }
  return merged;
}

/** Every language the reader knows, merged. */
export const WORDS: WordList = mergeWords(ID, EN);
