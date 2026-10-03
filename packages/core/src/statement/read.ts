import { exponentOf, parseNumber } from '../capture/amount';
import type { CaptureLine } from '../capture/types';
import type { StatementPeriod, StatementReading, StatementRow } from './types';
import { STATEMENT_WORDS } from './words';

/**
 * Reading a credit-card statement off the owner's screenshots.
 *
 * Each screenshot arrives as the lines Apple Vision read off it. Lines on one height are one printed row; a row with a
 * date at its left and an amount at its right end is a transaction, and a row with a balance label and an amount is
 * the summary. The year is never printed beside a row on most statements, so it comes from the statement's period.
 * Nothing leaves the phone and nothing is kept: this is a function from lines to rows.
 */

const W = STATEMENT_WORDS;

/** One printed row: its lines' texts, left to right, joined by a space. */
function rowsOf(lines: readonly CaptureLine[]): string[] {
  if (lines.length === 0) return [];
  const heights = lines.map((l) => l.height).sort((a, b) => a - b);
  const mid = Math.floor(heights.length / 2);
  const median = heights.length % 2 === 1 ? heights[mid]! : (heights[mid - 1]! + heights[mid]!) / 2;
  const tolerance = 0.6 * median;
  const placed = lines
    .map((l) => ({ text: l.text.trim(), x: l.box[0], centre: l.box[1] + l.box[3] / 2 }))
    .filter((l) => l.text !== '')
    .sort((a, b) => a.centre - b.centre);
  const groups: (typeof placed)[] = [];
  for (const l of placed) {
    const group = groups[groups.length - 1];
    // Measured against the row's first line, so a slow slope across many lines cannot chain two rows into one.
    if (group && Math.abs(l.centre - group[0]!.centre) <= tolerance) group.push(l);
    else groups.push([l]);
  }
  return groups.map((g) => g.sort((a, b) => a.x - b.x).map((l) => l.text).join(' ').replace(/\s+/g, ' ').trim());
}

/** A date as printed: day, month and maybe a year. */
interface PrintedDate {
  day: number;
  month: number;
  year: number | null;
  length: number;
}

/** `06MAY`, `06 MAY`, `6 Mei`, `12 Mei 2026`, `10JUN2026`. */
const WORD_DATE = /^(\d{1,2})\s?([A-Za-z]{3,})(?:\s?(\d{4}))?(?=\s|$)/;
/** `06/05`, `06-05-2026`, `06/05/26`. */
const NUMBER_DATE = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?(?=\s|$)/;

function dateAt(text: string): PrintedDate | null {
  const word = WORD_DATE.exec(text);
  if (word) {
    const month = W.months[word[2]!.slice(0, 3).toLowerCase()];
    if (month !== undefined) {
      return { day: Number(word[1]), month, year: word[3] === undefined ? null : Number(word[3]), length: word[0].length };
    }
  }
  const num = NUMBER_DATE.exec(text);
  if (num) {
    const raw = num[3];
    const year = raw === undefined ? null : raw.length === 2 ? 2000 + Number(raw) : raw.length === 4 ? Number(raw) : NaN;
    if (Number.isNaN(year)) return null;
    return { day: Number(num[1]), month: Number(num[2]), year, length: num[0].length };
  }
  return null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The ISO date, or null when there is no such day (31/02, 29 Feb in a common year). */
function isoOf(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

function shiftDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * The date in the statement's period: the printed year when there is one, otherwise the year that puts the day inside
 * the period give or take a week — the end's year first, then the start's, so a December row of a December–January
 * statement lands in December of the start's year.
 */
function placeDate(printed: PrintedDate, period: StatementPeriod): string | null {
  if (printed.year !== null) return isoOf(printed.year, printed.month, printed.day);
  const from = shiftDays(period.start, -7);
  const to = shiftDays(period.end, 7);
  const years = [Number(period.end.slice(0, 4)), Number(period.start.slice(0, 4))];
  for (const year of years) {
    const iso = isoOf(year, printed.month, printed.day);
    if (iso !== null && iso >= from && iso <= to) return iso;
  }
  for (const year of years) {
    const iso = isoOf(year, printed.month, printed.day);
    if (iso !== null) return iso;
  }
  return null;
}

/** Up to two dates at the left of a row, and where the text after them starts. */
function leadingDates(text: string, period: StatementPeriod): { dates: string[]; rest: number } {
  const dates: string[] = [];
  let at = 0;
  while (dates.length < 2) {
    const printed = dateAt(text.slice(at));
    if (!printed) break;
    const iso = placeDate(printed, period);
    if (iso === null) break;
    dates.push(iso);
    at += printed.length;
    while (text[at] === ' ') at += 1;
  }
  return { dates, rest: at };
}

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MARKERS = [...W.inMarkers, ...W.outMarkers].sort((a, b) => b.length - a.length).map(escape).join('|');
/** An amount at the end of a row, with a marker glued on or a space apart: `127,050`, `8,786,844CR`, `1.000.000 K`. */
const TRAILING_AMOUNT = new RegExp(`(?:^|\\s)([-+]?)(\\d[\\d.,]*)\\s*(${MARKERS})?$`, 'i');

/** The amount at the end of a row: signed minor units, and where it starts. */
function trailingAmount(text: string, currency: string): { minor: number; direction: 'in' | 'out'; start: number } | null {
  const match = TRAILING_AMOUNT.exec(text);
  if (!match) return null;
  const digits = match[2]!;
  const major = parseNumber(digits);
  if (major === null) return null;
  // A bare one- or two-digit figure is a page number or a count, not money.
  if (!/[.,]/.test(digits) && digits.length < 3) return null;
  const marker = match[3]?.toLowerCase();
  const sign = match[1];
  const direction = sign === '-' || sign === '+' || (marker !== undefined && W.inMarkers.includes(marker)) ? 'in' : 'out';
  const start = match.index + (match[0].length - match[0].trimStart().length);
  return { minor: Math.round(major * 10 ** exponentOf(currency)), direction, start };
}

const wordRegex = (words: readonly string[]) => new RegExp(`\\b(?:${words.map(escape).join('|')})\\b`, 'i');
const FEE = wordRegex(W.fee);
const PREVIOUS = wordRegex(W.previous);
const CLOSING = wordRegex(W.closing);

/** Two rows are the same printed row: what the overlap between screenshots compares. */
const sameRow = (a: StatementRow, b: StatementRow) =>
  a.on === b.on && a.description === b.description && a.amountMinor === b.amountMinor && a.direction === b.direction;

/** How many of `next`'s first rows repeat `previous`'s last rows: the longest such run. */
function overlapOf(previous: readonly StatementRow[], next: readonly StatementRow[]): number {
  for (let k = Math.min(previous.length, next.length); k >= 1; k -= 1) {
    const tail = previous.slice(previous.length - k);
    if (tail.every((row, i) => sameRow(row, next[i]!))) return k;
  }
  return 0;
}

/**
 * Every row of a statement, once, in statement order, with the closing and previous balances.
 *
 * `images` are the screenshots' Vision lines in the order they were handed over; `currency` is the card's.
 */
export function readStatement(images: readonly CaptureLine[][], period: StatementPeriod, currency: string): StatementReading {
  const rows: StatementRow[] = [];
  let closingMinor: number | null = null;
  let previousMinor: number | null = null;
  const emptyImages: number[] = [];
  let previousImageRows: StatementRow[] = [];

  images.forEach((lines, image) => {
    const imageRows: StatementRow[] = [];
    let balanceFound = false;
    for (const text of rowsOf(lines)) {
      const amount = trailingAmount(text, currency);
      if (amount === null) continue;
      const { dates, rest } = leadingDates(text, period);
      if (dates.length > 0) {
        const description = text.slice(rest, amount.start).replace(/\s+/g, ' ').trim();
        imageRows.push({
          on: dates[dates.length - 1]!,
          postedOn: dates.length === 2 ? dates[0]! : null,
          description,
          amountMinor: amount.minor,
          direction: amount.direction,
          isFee: FEE.test(description),
          image,
        });
        continue;
      }
      // A credit balance (CR, or a minus) is money the bank owes the card holder: negative.
      const signed = amount.direction === 'in' ? -amount.minor : amount.minor;
      if (PREVIOUS.test(text)) {
        balanceFound = true;
        if (previousMinor === null) previousMinor = signed;
      } else if (CLOSING.test(text)) {
        balanceFound = true;
        if (closingMinor === null) closingMinor = signed;
      }
    }
    if (imageRows.length === 0) {
      if (!balanceFound) emptyImages.push(image);
      return;
    }
    rows.push(...imageRows.slice(overlapOf(previousImageRows, imageRows)));
    previousImageRows = imageRows;
  });

  return { rows, closingMinor, previousMinor, emptyImages };
}

/** City and country words a card network appends to a merchant's name — geography, not brands. */
const TRAILING_PLACE = /(?:^|\s)(?:id|idn|jakarta(?: (?:slt|selat|pusat|barat|timur|utara))?|tangerang(?: kab)?|bandung|surabaya|bali|sg|my|us)$/;

/**
 * A description reduced to the merchant it names, so the same shop reads as one merchant from month to month: lower
 * case, digits and `*` gone, the city and country at the end gone, whitespace collapsed.
 */
export function merchantKeyOf(description: string): string {
  let key = description.toLowerCase().replace(/[\d*]/g, ' ').replace(/\s+/g, ' ').trim();
  for (;;) {
    const next = key.replace(TRAILING_PLACE, '').trim();
    if (next === key) return key;
    key = next;
  }
}
