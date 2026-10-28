import { currencyInfo } from '../money/currencies';
import { parseLooseDate } from './quick-entry';

/*
 * "Paste a list of purchases": people write simple notes, one purchase to a line, the amount last —
 *
 *   gocar 18000
 *   taxi bluebird 25k
 *   27/10
 *   catering 1,5jt
 *
 * This reads such a list into rows for a review screen. It is pure and never throws: a line that cannot be read is a row
 * with no amount, kept so the owner can type one or remove it, and a figure that looks like a typo is flagged rather than
 * refused. Every row is an expense; a refund or income is not read (a minus sign leaves the line unread).
 *
 * How an amount is read (the app's own format: a dot groups thousands, a comma is the decimal mark):
 *   18000  18.000  1.250.000  18 000      whole figures, grouped or not
 *   18,5   1.250,50                        a comma before cents
 *   1,250,000  1,250.50                    the other way round, when the last mark is a dot after a comma
 *   249k  2rb  2 ribu                      times a thousand
 *   1,5jt  2jt  1.5 juta                   times a million
 *   Rp 18.000  Rp18000  18.000,-           with a currency word or a closing ",-"
 * A single dot followed by three digits is a thousands dot (18.000); one followed by anything else is cents (1.25).
 * A single comma followed by three digits is read as thousands too (18,000) but marked `ambiguous`, since a comma is the
 * decimal mark here. Before a k/rb/jt suffix a lone dot or comma is always the decimal mark (1.5jt is one and a half
 * million; the three digits of 1.250k are decimals, not thousands, so that is 1.250 thousand).
 */

export type PurchaseLineStatus = 'ok' | 'no-amount' | 'suspicious';

export interface PurchaseLine {
  /** 1-based, from the pasted text as typed: stable however many blank, comment or date lines come between. */
  lineNo: number;
  /** The line as typed, bullet and all. */
  raw: string;
  /** The words with the amount taken out; empty when the line was only a figure. */
  note: string;
  /** In the currency's minor units; null while no amount could be read. */
  amountMinor: number | null;
  /** The day of the last date line above, or null when the page's own date applies. */
  occurredOn: string | null;
  /**
   * `no-amount`: nothing readable (or a minus sign, or zero) — goes under "Not read".
   * `suspicious`: read, but looks like a slip (a figure under 100 in a currency without cents, a rounded one, a huge one).
   */
  status: PurchaseLineStatus;
  /** The figure could have been read two ways, or had to be rounded: 18,000 · 1.25 in a currency without cents. */
  ambiguous: boolean;
}

export interface ParsePurchaseListOptions {
  /** The day the list is read, `YYYY-MM-DD`: a date line without a year takes this year. */
  today: string;
  /** The workspace's currency; decides the cents a figure may carry. Default IDR. */
  currency?: string;
}

const SUFFIX_POWER: Record<string, number> = { k: 3, rb: 3, ribu: 3, jt: 6, juta: 6 };

/** A figure over this many whole units is more likely a slip than a purchase. */
const HUGE_MAJOR = 10n ** 12n;

const BULLET = /^(?:[-*•–·]\s+|\d{1,3}[.)]\s+)/;

/** Weekday words in front of a date line ("Mon 27 Oct"). */
const WEEKDAY = /^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i;

// A figure: space-grouped (18 000), or digits joined by dots and commas (read by `readNumber`).
const NUMBER = String.raw`(?:\d{1,3}(?: \d{3})+(?:,\d+)?|\d+(?:[.,]\d+)*)`;
const AMOUNT = new RegExp(String.raw`(?<![\p{L}\p{N}.,])(?:rp\.?\s?)?(${NUMBER})(?:\s?(k|rb|ribu|jt|juta))?(?![\p{L}\p{N}])`, 'giu');

interface Read {
  /** Whole and fractional digits of the figure before any suffix: "1250" and "5" for 1.250,5. */
  int: string;
  frac: string;
  ambiguous: boolean;
}

const groups = (parts: string[]) => parts[0]!.length >= 1 && parts[0]!.length <= 3 && parts.slice(1).every((p) => p.length === 3);

/** The digits of a figure and which way its marks were read, or null when its marks make no sense (1.2.3). */
function readNumber(token: string, hasSuffix: boolean): Read | null {
  if (token.includes(' ')) {
    const [whole, cents] = token.split(',') as [string, string | undefined];
    return { int: whole.replace(/ /g, ''), frac: cents ?? '', ambiguous: false };
  }
  const dots = token.split('.').length - 1;
  const commas = token.split(',').length - 1;
  if (dots === 0 && commas === 0) return { int: token, frac: '', ambiguous: false };

  if (dots > 0 && commas > 0) {
    const last = token.lastIndexOf('.') > token.lastIndexOf(',') ? '.' : ',';
    const other = last === '.' ? ',' : '.';
    if ((last === '.' ? dots : commas) !== 1) return null;
    const [whole, cents] = token.split(last) as [string, string];
    const parts = whole.split(other);
    if (parts.some((p) => !/^\d+$/.test(p)) || !groups(parts)) return null;
    return { int: parts.join(''), frac: cents, ambiguous: false };
  }

  const mark = dots > 0 ? '.' : ',';
  const parts = token.split(mark);
  if (parts.length > 2) return groups(parts) ? { int: parts.join(''), frac: '', ambiguous: false } : null;
  const [whole, after] = parts as [string, string];
  const thousands = after.length === 3 && whole.length <= 3 && !hasSuffix;
  if (thousands) return { int: whole + after, frac: '', ambiguous: mark === ',' };
  return { int: whole, frac: after, ambiguous: false };
}

/** The figure in minor units, rounded half up, with whether any rounding was needed; null when it does not fit a safe integer. */
function toMinor(read: Read, power: number, exponent: number): { minor: number; rounded: boolean } | null {
  const digits = BigInt(`${read.int}${read.frac}` || '0');
  const numerator = digits * 10n ** BigInt(power + exponent);
  const denominator = 10n ** BigInt(read.frac.length);
  let minor = numerator / denominator;
  const rest = numerator % denominator;
  if (rest * 2n >= denominator && rest !== 0n) minor += 1n;
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return { minor: Number(minor), rounded: rest !== 0n };
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * The day a line names when the whole line is a date: 27/10 · 27/10/2026 · 27-10 · 27 Oct · Oct 27 · 2026-10-27,
 * day first. Without a year it is this year, or last year when that would put it more than a month ahead.
 */
function dateLine(text: string, today: string): string | null {
  const s = text.replace(WEEKDAY, '').replace(/[\s:.\-–]+$/, '').trim();
  const shaped = /^\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?$/.test(s) || /^\d{4}-\d{1,2}-\d{1,2}$/.test(s) || /^\d{1,2}\s+[a-z]{3,}\.?(?:,?\s+\d{4})?$/i.test(s) || /^[a-z]{3,}\.?\s+\d{1,2}(?:,?\s+\d{4})?$/i.test(s);
  if (!shaped) return null;
  const found = parseLooseDate(s, today);
  if (!found) return null;
  const year = Number(today.slice(0, 4));
  const before = parseLooseDate(s, `${year - 1}-01-01`);
  const yearless = before !== null && before.slice(0, 4) !== found.slice(0, 4);
  if (yearless && found > addDays(today, 31)) return before;
  return found;
}

const trimNote = (text: string) =>
  text
    .replace(/\s+/g, ' ')
    .replace(/^[\s:;,@=\-–]+|[\s:;,@=\-–]+$/g, '')
    .trim();

/**
 * Reads a pasted list into one row per purchase (see the notes at the top of the file). Blank lines and lines starting
 * with `#` or `//` are skipped, a line that is only a date sets the day of the lines below it, and a leading bullet or
 * list number ("- ", "* ", "1. ", "2) ") is dropped. In each remaining line the last figure is the amount and the
 * rest, in order, is the note.
 */
export function parsePurchaseList(text: string, options: ParsePurchaseListOptions): PurchaseLine[] {
  const currency = options.currency ?? 'IDR';
  const { exponent } = currencyInfo(currency);
  const rows: PurchaseLine[] = [];
  let day: string | null = null;

  text.split(/\r\n|\r|\n/).forEach((raw, index) => {
    const lineNo = index + 1;
    let line = raw.replace(/\t+/g, ' ').replace(/ /g, ' ').trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) return;

    const asDate = dateLine(line, options.today);
    if (asDate) {
      day = asDate;
      return;
    }

    line = line.replace(BULLET, '').trim();
    if (!line) return;
    // "18.000,-" and "18.000.-": a closing dash after the figure.
    const cleaned = line.replace(/(\d)[.,]-+/g, '$1');

    const found = [...cleaned.matchAll(AMOUNT)].at(-1);
    const unread = (): PurchaseLine => ({ lineNo, raw, note: trimNote(cleaned), amountMinor: null, occurredOn: day, status: 'no-amount', ambiguous: false });
    if (!found) {
      rows.push(unread());
      return;
    }

    const start = found.index;
    const end = start + found[0].length;
    const note = trimNote(`${cleaned.slice(0, start)} ${cleaned.slice(end)}`);
    // A minus in front of the figure is a refund or a negative: not a purchase, so not read.
    if (/(?:^|\s)[-−–]$/.test(cleaned.slice(0, start))) {
      rows.push(unread());
      return;
    }

    const suffix = found[2]?.toLowerCase();
    const read = readNumber(found[1]!, suffix !== undefined);
    const minor = read ? toMinor(read, suffix ? SUFFIX_POWER[suffix]! : 0, exponent) : null;
    if (!read || !minor || minor.minor <= 0) {
      rows.push(unread());
      return;
    }

    const ambiguous = read.ambiguous || minor.rounded;
    const major = BigInt(minor.minor) / 10n ** BigInt(exponent);
    // Under 100 whole units where a currency has no cents (a ride for 2 rupiah), under 1 where it has: a dropped zero or a quantity.
    const small = exponent === 0 ? minor.minor < 100 : minor.minor < 10 ** exponent;
    const suspicious = ambiguous || small || major >= HUGE_MAJOR;
    rows.push({ lineNo, raw, note, amountMinor: minor.minor, occurredOn: day, status: suspicious ? 'suspicious' : 'ok', ambiguous });
  });

  return rows;
}
