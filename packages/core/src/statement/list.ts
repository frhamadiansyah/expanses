import { exponentOf, parseNumber } from '../capture/amount';
import type { CaptureLine } from '../capture/types';
import { leadingDateOf } from './read';

/**
 * Reading a wallet's or a bank's transaction list off screenshots: each entry a date (and a time), a description, a long
 * reference id, the source it was paid from, and a signed amount. Unlike a card statement the entries are not one
 * printed row each: the lines of one entry sit above one another, so they are put together by where they stand.
 *
 * Nothing leaves the phone and nothing is kept: a function from Vision's lines to rows.
 */

export interface ListRow {
  /** The entry's date, ISO. */
  on: string;
  /** The time printed with the date (`12:31`), or null. Never used to match. */
  time: string | null;
  description: string;
  /** What the entry was paid from or into, as printed (kept as extra text); null when none was printed. */
  source: string | null;
  /** The long reference id, or null. It identifies an entry across overlapping screenshots and is never recorded. */
  ref: string | null;
  /** Positive, in the account currency's minor units; for a row paid in coins, the figure printed (not money). */
  amountMinor: number;
  /** `out` for a minus amount; `in` for a plus or an unsigned amount. */
  direction: 'out' | 'in';
  /** Paid in coins or points: a bare figure, not money. Such a row is skipped, never recorded. */
  coins: boolean;
  /** Index of the screenshot it came from, 0-based. */
  image: number;
}

export interface ListReading {
  rows: ListRow[];
  /** Images that gave no row at all. */
  emptyImages: number[];
}

/** Words naming what is not money: a source or description saying the entry was paid in coins or points. */
const COIN_WORDS = /\b(?:coins?|koin|poin|points?|pts)\b/i;
const MINUS = '-−–—';
const AMOUNT = new RegExp(`^([${MINUS}+]?)\\s*(Rp\\.?|IDR)?\\s*([${MINUS}+]?)\\s*(\\d[\\d.,]*)$`, 'i');
const TRAILING = new RegExp(`(?:^|\\s)([${MINUS}+]?)\\s*(Rp\\.?|IDR)\\s*([${MINUS}+]?)\\s*(\\d[\\d.,]*)$`, 'i');
const TIME = /^\d{1,2}[:.]\d{2}(?::\d{2})?(?:\s?(?:am|pm|wib|wita|wit))?$/i;
const LEADING_TIME = /^(\d{1,2}[:.]\d{2}(?::\d{2})?(?:\s?(?:am|pm|wib|wita|wit))?)(?=\s|$)\s*/i;
/** One long token of letters and digits with at least four digits, optionally behind a label: a reference id. */
const REF = /^(?:(?:ref(?:erence)?|id|no)\.?\s*[:#]?\s*)?([A-Za-z0-9][A-Za-z0-9_-]{9,})$/i;

interface Amount {
  minor: number;
  direction: 'out' | 'in';
  marked: boolean;
  bare: boolean;
}

function amountFrom(match: RegExpExecArray, currency: string): Amount | null {
  const digits = match[4]!;
  const major = parseNumber(digits);
  if (major === null) return null;
  const sign = match[1] || match[3] || '';
  return {
    minor: Math.round(major * 10 ** exponentOf(currency)),
    direction: sign !== '' && MINUS.includes(sign) ? 'out' : 'in',
    marked: Boolean(match[2]),
    bare: !/[.,]/.test(digits),
  };
}

interface Piece {
  text: string;
  x: number;
  y: number;
}

const isRef = (text: string) => {
  const m = REF.exec(text);
  return m !== null && (m[1]!.match(/\d/g)?.length ?? 0) >= 4;
};

const DAY_MS = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Same entry, for the overlap of two screenshots when no reference id tells. */
const same = (a: ListRow, b: ListRow) =>
  a.ref !== null && b.ref !== null
    ? a.ref === b.ref
    : a.on === b.on && a.description === b.description && a.amountMinor === b.amountMinor && a.direction === b.direction;

type Found = ListRow & { marked: boolean };

function readImage(lines: readonly CaptureLine[], image: number, period: { start: string; end: string }, currency: string): Found[] {
  const heights = lines.map((l) => l.height).sort((a, b) => a - b);
  const median = heights.length === 0 ? 0 : heights[Math.floor(heights.length / 2)]!;
  const dates: { iso: string; y: number; time: string | null }[] = [];
  const amounts: (Amount & { y: number })[] = [];
  const texts: Piece[] = [];
  for (const l of lines) {
    const y = l.box[1] + l.box[3] / 2;
    let text = l.text.replace(/\s+/g, ' ').trim();
    if (text === '') continue;
    const date = leadingDateOf(text, period, period.end);
    if (date) {
      text = text.slice(date.length);
      const time = LEADING_TIME.exec(text);
      if (time) text = text.slice(time[0].length);
      dates.push({ iso: date.iso, y, time: time?.[1] ?? null });
      if (text === '') continue;
    }
    const whole = AMOUNT.exec(text);
    const found = whole ? amountFrom(whole, currency) : null;
    if (found) {
      amounts.push({ ...found, y });
      continue;
    }
    const tail = TRAILING.exec(text);
    const trailing = tail ? amountFrom(tail, currency) : null;
    if (tail && trailing) {
      amounts.push({ ...trailing, y });
      text = text.slice(0, tail.index).trim();
    }
    if (text !== '' && !TIME.test(text)) texts.push({ text, x: l.box[0], y });
  }
  dates.sort((a, b) => a.y - b.y);

  // One date and one amount to an entry: with as many of one as of the other, the first date goes with the first amount
  // and so on (whichever line of the entry the date stands on). Otherwise each date takes the amount nearest to it.
  amounts.sort((a, b) => a.y - b.y);
  const pairs = dates.length === amounts.length ? dates.map((_, i) => ({ di: i, ai: i, gap: 0 })) : dates
    .flatMap((d, di) => amounts.map((a, ai) => ({ di, ai, gap: Math.abs(d.y - a.y) })))
    .sort((a, b) => a.gap - b.gap || a.di - b.di);
  const amountOf = new Map<number, number>();
  const usedAmounts = new Set<number>();
  for (const p of pairs) {
    if (amountOf.has(p.di) || usedAmounts.has(p.ai)) continue;
    amountOf.set(p.di, p.ai);
    usedAmounts.add(p.ai);
  }

  const records = dates.flatMap((d, di) => {
    const a = amountOf.get(di);
    if (a === undefined) return [];
    const amount = amounts[a]!;
    return [{ date: d, amount, lo: Math.min(d.y, amount.y), hi: Math.max(d.y, amount.y), pieces: [] as Piece[] }];
  });
  // The other lines belong to the entry whose date and amount they stand nearest, within a few lines' height of it.
  const reach = 3 * median;
  for (const piece of texts) {
    let best: (typeof records)[number] | null = null;
    let bestGap = Infinity;
    for (const r of records) {
      const gap = piece.y < r.lo ? r.lo - piece.y : piece.y > r.hi ? piece.y - r.hi : 0;
      if (gap < bestGap) {
        best = r;
        bestGap = gap;
      }
    }
    if (best && bestGap <= reach) best.pieces.push(piece);
  }

  return records.map((r): Found => {
    const pieces = r.pieces.sort((a, b) => a.y - b.y || a.x - b.x);
    let ref: string | null = null;
    const words: string[] = [];
    for (const p of pieces) {
      if (isRef(p.text)) ref ??= REF.exec(p.text)![1]!;
      else words.push(p.text);
    }
    const sourceAt = words.findIndex((w) => COIN_WORDS.test(w));
    const other = words.findIndex((_, i) => i !== sourceAt);
    const descriptionAt = other >= 0 ? other : sourceAt;
    const rest = words.filter((_, i) => i !== descriptionAt);
    return {
      on: r.date.iso,
      time: r.date.time,
      description: descriptionAt >= 0 ? words[descriptionAt]! : '',
      source: rest.length > 0 ? rest.join(' ') : null,
      ref,
      amountMinor: r.amount.minor,
      direction: r.amount.direction,
      coins: !r.amount.marked && r.amount.bare,
      image,
      marked: r.amount.marked,
    };
  });
}

/**
 * Every entry of a list once, in the order printed, from the screenshots' Vision lines. `today` places a date that
 * prints no year within the year before it; `currency` is the account's.
 */
export function readTransactionList(images: readonly CaptureLine[][], opts: { today: string; currency: string }): ListReading {
  const end = Date.parse(`${opts.today}T00:00:00Z`);
  const period = { start: isoDay(end - 366 * DAY_MS), end: opts.today };
  const emptyImages: number[] = [];
  const perImage = images.map((lines, i) => readImage(lines, i, period, opts.currency));
  // A figure with no currency mark and no separator is coins when the list marks the rest in money; a source that names
  // coins or points makes it so wherever it stands.
  const anyMarked = perImage.some((found) => found.some((r) => r.marked));
  const rows: ListRow[] = [];
  const seen = new Set<string>();
  let previous: ListRow[] = [];
  perImage.forEach((found, image) => {
    const clean: ListRow[] = found.map(({ marked: _marked, ...row }) => ({
      ...row,
      coins: COIN_WORDS.test(`${row.source ?? ''} ${row.description}`) || (row.coins && anyMarked),
    }));
    if (clean.length === 0) {
      emptyImages.push(image);
      return;
    }
    // The run at the head that repeats the screenshot before it is that one's tail, seen again.
    let overlap = 0;
    for (let k = Math.min(previous.length, clean.length); k >= 1; k -= 1) {
      const tail = previous.slice(previous.length - k);
      if (tail.every((row, i) => same(row, clean[i]!))) {
        overlap = k;
        break;
      }
    }
    for (const row of clean.slice(overlap)) {
      if (row.ref !== null) {
        if (seen.has(row.ref)) continue;
        seen.add(row.ref);
      }
      rows.push(row);
    }
    previous = clean;
  });
  return { rows, emptyImages };
}
