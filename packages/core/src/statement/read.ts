import { exponentOf, parseNumber } from '../capture/amount';
import { isSupportedCurrency } from '../money/currencies';
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
  /** `word` for `06MAY`, `numeric` for `06/05`: a statement prints both of a row's dates the same way. */
  shape: 'word' | 'numeric';
}

const escapeClass = (c: string) => c.replace(/[\]\\^-]/g, '\\$&');
/** The marks that may join a date's parts, a space aside: `-`, `/`, `.`. */
const JOINING_MARKS = W.dateSeparators.filter((c) => c.trim() !== '');
/** A day, then one separator or none, then a word: `06MAY`, `06 MAY`, `6 Mei`, `05-Mar`, `14-OKT`, `8/Agu`. */
const WORD_DATE_HEAD = new RegExp(`^(\\d{1,2})([${W.dateSeparators.map(escapeClass).join('')}]?)([A-Za-z]{3,})`);
/** `06/05`, `06-05-2026`, `06/05/26`. */
const NUMBER_DATE = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?(?=\s|$)/;
const ends = (text: string, at: number) => at === text.length || /\s/.test(text[at]!);

/**
 * The year after a word date's month, where `at` is just past the month. After a joining mark (`05-Mar-26`) it is that
 * same mark and two or four digits. After a space or nothing it is four digits, a space apart or not (`12 Mei 2026`,
 * `10JUN2026`): two digits after a bare space are the description's (`06 MAY 10 PCS`).
 */
function wordYearAt(text: string, at: number, separator: string): { year: number; end: number } | null {
  const rest = text.slice(at);
  const year = JOINING_MARKS.includes(separator)
    ? new RegExp(`^${separator.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(\\d{4}|\\d{2})`).exec(rest)
    : /^\s?(\d{4})/.exec(rest);
  if (!year || !ends(text, at + year[0].length)) return null;
  const digits = year[1]!;
  return { year: Number(digits.length === 2 ? `20${digits}` : digits), end: at + year[0].length };
}

function dateAt(text: string): PrintedDate | null {
  const word = WORD_DATE_HEAD.exec(text);
  if (word) {
    // The whole word must be a month — `MAY`, `Mei`, `August` — so a shop called `3 MAYxxx` is not the 3rd of May.
    const name = word[3]!.toLowerCase();
    const month = W.months[name] ?? W.monthNames[name];
    const at = word[0].length;
    if (month !== undefined) {
      const year = wordYearAt(text, at, word[2]!);
      if (year) return { day: Number(word[1]), month, year: year.year, length: year.end, shape: 'word' };
      if (ends(text, at)) return { day: Number(word[1]), month, year: null, length: at, shape: 'word' };
    }
  }
  const num = NUMBER_DATE.exec(text);
  if (num) {
    const raw = num[3];
    const year = raw === undefined ? null : raw.length === 2 ? 2000 + Number(raw) : raw.length === 4 ? Number(raw) : NaN;
    if (Number.isNaN(year)) return null;
    return { day: Number(num[1]), month: Number(num[2]), year, length: num[0].length, shape: 'numeric' };
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

const DAY_MS = 86_400_000;
/** The most days a bank posts a purchase after it happened; a later "posting date" is a misread. */
const MAX_POSTING_LAG_DAYS = 60;
const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);

/**
 * The date in the statement's period: the printed year when there is one, otherwise the year that puts the day
 * nearest the period — inside it when it can, so a December row of a December–January statement lands in December of
 * the start's year, and a December row before a period lying wholly in January lands in the December before it,
 * never a year ahead. Of two years equally near, the earlier: a statement lists what has happened.
 */
function placeDate(printed: PrintedDate, period: StatementPeriod): string | null {
  if (printed.year !== null) return isoOf(printed.year, printed.month, printed.day);
  const from = dayNumber(period.start);
  const to = dayNumber(period.end);
  const end = Number(period.end.slice(0, 4));
  const start = Number(period.start.slice(0, 4));
  let best: { iso: string; distance: number } | null = null;
  for (let year = start - 1; year <= end + 1; year += 1) {
    const iso = isoOf(year, printed.month, printed.day);
    if (iso === null) continue;
    const day = dayNumber(iso);
    const distance = day < from ? from - day : day > to ? day - to : 0;
    if (best === null || distance < best.distance) best = { iso, distance };
  }
  return best?.iso ?? null;
}

/**
 * Up to two dates at the left of a row, and where the text after them starts. A second date counts only in the first's
 * shape: `06/05 3 MAY...` is one date and a description, `07MAY 06MAY` is two dates.
 */
function leadingDates(text: string, period: StatementPeriod): { dates: string[]; rest: number } {
  const dates: string[] = [];
  let shape: PrintedDate['shape'] | null = null;
  let at = 0;
  while (dates.length < 2) {
    const printed = dateAt(text.slice(at));
    if (!printed || (shape !== null && printed.shape !== shape)) break;
    shape = printed.shape;
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
function trailingAmount(text: string, currency: string): { minor: number; direction: 'in' | 'out'; start: number; bare: boolean } | null {
  const match = TRAILING_AMOUNT.exec(text);
  if (!match) return null;
  const digits = match[2]!;
  const major = parseNumber(digits);
  if (major === null) return null;
  // A bare one- or two-digit figure: on a row it is a page number or a count, not money; beside a balance's label
  // (`Previous Balance 0`) it is the balance.
  const bare = !/[.,]/.test(digits) && digits.length < 3;
  const marker = match[3]?.toLowerCase();
  const sign = match[1];
  const direction = sign === '-' || sign === '+' || (marker !== undefined && W.inMarkers.includes(marker)) ? 'in' : 'out';
  const start = match.index + (match[0].length - match[0].trimStart().length);
  return { minor: Math.round(major * 10 ** exponentOf(currency)), direction, start, bare };
}

const wordRegex = (words: readonly string[]) => new RegExp(`\\b(?:${words.map(escape).join('|')})\\b`, 'i');
const FEE = wordRegex(W.fee);
const PREVIOUS = wordRegex(W.previous);
const CLOSING = wordRegex(W.closing);

/** A foreign purchase's detail line, as printed: not yet known to belong to any row. */
interface ForeignDetail {
  currency: string;
  original: number;
  rate: number;
  direction: 'in' | 'out';
}

/** The detail line a text is (`words.ts`'s `foreignDetail`), or null. */
function foreignDetailOf(text: string): ForeignDetail | null {
  const groups = W.foreignDetail.exec(text)?.groups;
  if (!groups) return null;
  const original = parseNumber(groups.amount!);
  const rate = parseNumber(groups.rate!);
  if (original === null || rate === null || original <= 0 || rate <= 0) return null;
  const marker = groups.marker?.toLowerCase();
  if (marker !== undefined && !W.inMarkers.includes(marker) && !W.outMarkers.includes(marker)) return null;
  const direction = marker !== undefined && W.inMarkers.includes(marker) ? 'in' : 'out';
  return { currency: groups.currency!.toUpperCase(), original, rate, direction };
}

/** How far the charged amount may be from the original times the printed rate: a bank rounds the rate it prints. */
const DETAIL_TOLERANCE = 0.005;

/**
 * The row's original currency and amount from a detail line, or null when they do not belong together: a currency the
 * app does not know or the card's own, a credit beside a charge, or figures that do not multiply to the charge.
 */
function originalOf(row: StatementRow, detail: ForeignDetail, currency: string): StatementRow['original'] | null {
  if (!isSupportedCurrency(detail.currency) || detail.currency === currency.toUpperCase()) return null;
  if (detail.direction !== row.direction) return null;
  const charged = row.amountMinor / 10 ** exponentOf(currency);
  if (charged <= 0 || Math.abs(charged - detail.original * detail.rate) / charged > DETAIL_TOLERANCE) return null;
  const amountMinor = Math.round(detail.original * 10 ** exponentOf(detail.currency));
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null;
  return { currency: detail.currency, amountMinor };
}

/** Gives a row the detail line's original when it has none yet and the two belong together. */
function attach(row: StatementRow | undefined, detail: ForeignDetail, currency: string): void {
  if (!row || row.original) return;
  const original = originalOf(row, detail, currency);
  if (original) row.original = original;
}

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
    /** A detail line above the image's first row: the end of a row on the screenshot before. */
    let openingDetail: ForeignDetail | null = null;
    for (const text of rowsOf(lines)) {
      // A foreign purchase's detail line belongs to the row read before it, even across a page's footer and headings.
      const detail = foreignDetailOf(text);
      if (detail) {
        if (imageRows.length > 0) attach(imageRows[imageRows.length - 1], detail, currency);
        else openingDetail ??= detail;
        continue;
      }
      const amount = trailingAmount(text, currency);
      if (amount === null) continue;
      const { dates, rest } = leadingDates(text, period);
      const description = dates.length > 0 && amount.start >= rest ? text.slice(rest, amount.start).replace(/\s+/g, ' ').trim() : '';
      // A transaction has a date, then a description, then the amount; a lone `12 Mei 2026` is a date, not Rp2.026.
      if (description !== '') {
        if (amount.bare) continue;
        // A bank never posts before the purchase: of two dates, the earlier is the transaction's, whichever column.
        // A posting date months after it is a misread, not a posting: it is dropped.
        const [on, posted] = [...dates].sort();
        const postedOn = dates.length === 2 && dayNumber(posted!) - dayNumber(on!) <= MAX_POSTING_LAG_DAYS ? posted! : null;
        imageRows.push({
          on: on!,
          postedOn,
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
      // A screenshot of only a detail line (and headings) ends the row above it: it read something, so it is not empty.
      if (openingDetail) attach(previousImageRows[previousImageRows.length - 1], openingDetail, currency);
      else if (!balanceFound) emptyImages.push(image);
      return;
    }
    const overlap = overlapOf(previousImageRows, imageRows);
    // The opening detail belongs to the row just above where this screenshot starts: the one before the repeated run.
    if (openingDetail) attach(previousImageRows[previousImageRows.length - overlap - 1], openingDetail, currency);
    // A repeated row keeps a detail only the repeat shows (the first screenshot cut it off), and the repeat stands for
    // the row kept, so the next screenshot's opening detail reaches the row that is read.
    previousImageRows.slice(previousImageRows.length - overlap).forEach((kept, i) => {
      if (!kept.original && imageRows[i]!.original) kept.original = imageRows[i]!.original;
      imageRows[i] = kept;
    });
    rows.push(...imageRows.slice(overlap));
    previousImageRows = imageRows;
  });

  return { rows, closingMinor, previousMinor, emptyImages };
}

/** The place words a card network appends to a merchant's name (`words.ts`), at the end of a description. */
const TRAILING_PLACE = new RegExp(`(?:^|\\s)(?:${[...W.trailingPlaces].sort((a, b) => b.length - a.length).map(escape).join('|')})$`);

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
