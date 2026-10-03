import { currencyInfo, isSupportedCurrency } from '../money/currencies';
import type { WordList } from './types';

/**
 * How many minor units a major unit is: the app's own currency table (IDR is 0 there by product decision), and two
 * for a currency the app does not keep.
 *
 * A figure that wears no currency — `50rb`, `1,2jt` — is kept in whole units (0): it cannot be scaled until the
 * account it lands on says what it is, and the ingest does that (`exponentOf(currency)` once it is known).
 */
export function exponentOf(currency: string | null): number {
  if (currency === null) return 0;
  return isSupportedCurrency(currency) ? currencyInfo(currency).exponent : 2;
}

/** One money figure found in a text: what it comes to, what it says it is, and where it was. */
export interface FoundAmount {
  minor: number;
  currency: string | null;
  /** Index of the currency mark, or of the first digit when the figure carries no mark. */
  start: number;
  /** Index just past the figure. */
  end: number;
}

/**
 * Every mark a printed amount wears, longest first, with the currency it means.
 *
 * `S$` before `$` and `RM` before nothing else, because the first match at a position wins and `S$12` is Singapore
 * dollars, not dollars.
 */
const CURRENCY_MARKS: readonly (readonly [string, string])[] = [
  ['S$', 'SGD'],
  ['Rp', 'IDR'],
  ['IDR', 'IDR'],
  ['USD', 'USD'],
  ['SGD', 'SGD'],
  ['MYR', 'MYR'],
  ['EUR', 'EUR'],
  ['JPY', 'JPY'],
  ['GBP', 'GBP'],
  ['RM', 'MYR'],
  ['$', 'USD'],
  ['€', 'EUR'],
  ['¥', 'JPY'],
  ['£', 'GBP'],
];

/** A digit run with its separators: `38.000`, `1,250,000.00`, `1.250.000,00`, `12.50`. */
const NUMBER = /^\d+(?:[.,]\d+)*/;

/** The figure at `from`, with the shorthand that may follow it. */
interface NumberAt {
  major: number;
  end: number;
  /** True when a thousand/million shorthand was read, which is what lets a figure with no currency mark count. */
  shorthand: boolean;
}

/**
 * What a digit run with separators comes to.
 *
 * A separator with one or two digits after it, at the end, is a decimal point — the way a person writes cents. Any
 * other separator is a thousands mark and must be followed by exactly three digits, so `1.2345` is not an amount at
 * all rather than a number nobody meant. Both spellings are read, because both are printed: `1.250.000,00` and
 * `1,250,000.00` are the same money.
 */
export function parseNumber(raw: string): number | null {
  const lastSep = Math.max(raw.lastIndexOf('.'), raw.lastIndexOf(','));
  let whole = raw;
  let fraction = '';
  if (lastSep >= 0) {
    const tail = raw.slice(lastSep + 1);
    if (/^\d{1,2}$/.test(tail)) {
      whole = raw.slice(0, lastSep);
      fraction = tail;
    }
  }
  const groups = whole.split(/[.,]/);
  if (groups.some((group) => group.length === 0)) return null;
  if (groups.length > 1 && !groups.slice(1).every((group) => group.length === 3)) return null;
  const digits = groups.join('');
  if (!/^\d+$/.test(digits)) return null;
  return Number(digits) + (fraction === '' ? 0 : Number(`0.${fraction}`));
}

/** The currency mark at `i`, if one starts there. */
function markAt(text: string, i: number): { code: string; length: number } | null {
  for (const [mark, code] of CURRENCY_MARKS) {
    if (text.slice(i, i + mark.length).toLowerCase() !== mark.toLowerCase()) continue;
    // A letter mark must be a word of its own: "IDR" is money, "IDRX" is not, and the "rm" ending "confirm" is not
    // ringgit.
    const after = text[i + mark.length];
    const before = i > 0 ? text[i - 1] : undefined;
    if (/[A-Za-z]/.test(mark) && after !== undefined && /[A-Za-z]/.test(after)) continue;
    if (/^[A-Za-z]/.test(mark) && before !== undefined && /[A-Za-z]/.test(before)) continue;
    return { code, length: mark.length };
  }
  return null;
}

/** Thousand and million shorthand, as the language writes it: `rb`, `ribu`, `k`, `jt`, `juta`, `m`. */
function shorthandAt(text: string, i: number, words: WordList): { end: number; factor: number } | null {
  const lists: readonly (readonly [string[], number])[] = [
    [words.million, 1_000_000],
    [words.thousand, 1_000],
  ];
  for (const [list, factor] of lists) {
    for (const word of list) {
      if (text.slice(i, i + word.length).toLowerCase() !== word) continue;
      const after = text[i + word.length];
      // A shorthand is a word of its own: `5rb` is money, `5rb` followed by letters is not, and `5 m` is only money
      // when nothing longer follows the `m`.
      if (after !== undefined && /[A-Za-z0-9]/.test(after)) continue;
      return { end: i + word.length, factor };
    }
  }
  return null;
}

/** The figure at `from` — spaces allowed after the mark, as in `Rp 1.250.000` — with its shorthand. */
function numberAt(text: string, from: number, words: WordList): NumberAt | null {
  let i = from;
  while (text[i] === ' ' || text[i] === '\t') i += 1;
  const match = NUMBER.exec(text.slice(i));
  if (!match) return null;
  const major = parseNumber(match[0]);
  if (major === null) return null;
  let end = i + match[0].length;
  let j = end;
  while (text[j] === ' ' || text[j] === '\t') j += 1;
  const short = shorthandAt(text, j, words);
  if (short) return { major: major * short.factor, end: short.end, shorthand: true };
  return { major, end, shorthand: false };
}

/** Major units to the integer minor units the app stores. */
function toMinor(major: number, currency: string | null): number {
  return Math.round(major * 10 ** exponentOf(currency));
}

/**
 * Every money figure in a text, in the order they were printed.
 *
 * A figure counts when it wears a currency mark or a shorthand (`Rp38.000`, `$12.50`, `50rb`, `1,2jt`). A bare number
 * does not: account numbers, OTP codes, dates and reference numbers are all digits, and a reader that treats any of
 * them as money is worse than one that finds nothing.
 */
export function findAmounts(text: string, words: WordList): FoundAmount[] {
  const found: FoundAmount[] = [];
  let i = 0;
  while (i < text.length) {
    const mark = markAt(text, i);
    const from = mark === null ? i : i + mark.length;
    const number = numberAt(text, from, words);
    if (number && (mark !== null || number.shorthand)) {
      const currency = mark?.code ?? null;
      found.push({ minor: toMinor(number.major, currency), currency, start: i, end: number.end });
      i = number.end;
      continue;
    }
    i = mark === null ? i + 1 : from;
  }
  return found;
}
