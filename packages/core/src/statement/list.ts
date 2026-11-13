import { exponentOf, parseNumber } from '../capture/amount';
import type { CaptureLine } from '../capture/types';
import { leadingDateOf } from './read';
import { STATEMENT_WORDS } from './words';

/**
 * Reading a wallet's or a bank's transaction list off screenshots: each entry a date (and a time), a description, a long
 * reference id, the source it was paid from, and a signed amount. Unlike a card statement the entries are not one
 * printed row each: the lines of one entry sit above one another, so they are put together by where they stand.
 * Within an entry the lines are read by column, a wrapped cell whole: in a table (date | transaction | id | payment |
 * amount) the transaction's column is the description and the payment's only ever the source, with or without the
 * heading row in the screenshot.
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
  /**
   * Paid in coins or points: a bare figure, not money. `readTransactionList` leaves such rows out, so its rows are always
   * false here; the field stays for the matcher, which skips any it is given.
   */
  coins: boolean;
  /** Index of the screenshot it came from, 0-based. */
  image: number;
}

export interface ListReading {
  rows: ListRow[];
  /** Images that gave no row at all (a screenshot of coins rows only gave rows, though none is kept). */
  emptyImages: number[];
}

/** Words naming what is not money: a source saying the entry was paid in coins or points. */
const COIN_WORDS = /\b(?:coins?|koin|poin|points?|pts)\b/i;
/** A source that is coins alone (`Coins`, `Wallet Coins`), not money with coins beside it (`Wallet Saldo + Coins`). */
const COINS_ONLY = /^(?:(?:\S+\s+)?(?:coins?|koin)|poin|points?|pts)$/i;
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
  /** Left and right edges, as fractions of the picture's width. */
  x: number;
  right: number;
  /** The line's centre, as a fraction of the picture's height. */
  y: number;
}

const isRef = (text: string) => {
  const m = REF.exec(text);
  return m !== null && (m[1]!.match(/\d/g)?.length ?? 0) >= 4;
};

/** Two lines start this close are one left edge: one column. */
const SAME_EDGE = 0.02;
/** How far a row's column may stand from where the list's column is, and still be it. */
const COLUMN_REACH = 0.04;

const HEADINGS = STATEMENT_WORDS.listHeadings;
const headingOf = (text: string): keyof typeof HEADINGS | null => {
  const t = text.toLowerCase().trim();
  for (const key of Object.keys(HEADINGS) as (keyof typeof HEADINGS)[]) if (HEADINGS[key].includes(t)) return key;
  return null;
};

const overlap = (a: Piece, b: Piece) => Math.min(a.right, b.right) - Math.max(a.x, b.x);

/** An entry's lines by column, left to right, each top to bottom: lines one above the other at one left edge, or lying mostly across one another, are one cell. */
function columnsOf(pieces: readonly Piece[]): Piece[][] {
  const columns: Piece[][] = [];
  for (const p of [...pieces].sort((a, b) => a.x - b.x)) {
    const column = columns.find((c) => c.some((q) => Math.abs(q.x - p.x) <= SAME_EDGE || overlap(q, p) >= 0.5 * Math.min(q.right - q.x, p.right - p.x)));
    if (column) column.push(p);
    else columns.push([p]);
  }
  return columns.map((c) => c.sort((a, b) => a.y - b.y));
}

interface Column {
  x: number;
  /** Its lines that are words, top to bottom. */
  words: string[];
  ref: string | null;
}

/**
 * One column of an entry: its reference, and its other lines. A reference wrapped onto a second line is mended: the
 * line just under it at its edge, one token with a digit and no longer than it, is its end. A column the list's
 * heading names as the id column is a reference whole.
 */
function readColumn(lines: readonly Piece[], median: number, idColumn: boolean): Column {
  const x = Math.min(...lines.map((l) => l.x));
  const tokens = lines.every((l) => !/\s/.test(l.text));
  const joined = lines.map((l) => l.text).join('');
  if (lines.length > 1 && tokens && (idColumn || isRef(joined))) return { x, words: [], ref: joined };
  let ref: string | null = null;
  const words: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i]!.text;
    if (!isRef(text) && !(idColumn && lines.length === 1 && tokens)) {
      words.push(text);
      continue;
    }
    let value = REF.exec(text)?.[1] ?? text;
    const next = lines[i + 1];
    if (next && /^[A-Za-z0-9_-]+$/.test(next.text) && /\d/.test(next.text) && next.text.length <= value.length && next.y - lines[i]!.y <= 1.6 * median) {
      value += next.text;
      i += 1;
    }
    ref ??= value;
  }
  return { x, words, ref };
}

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
  const dates: { iso: string; x: number; y: number; time: string | null }[] = [];
  const amounts: (Amount & Piece)[] = [];
  const times: { time: string; x: number; y: number }[] = [];
  const texts: Piece[] = [];
  for (const l of lines) {
    const y = l.box[1] + l.box[3] / 2;
    const x = l.box[0];
    const right = l.box[0] + l.box[2];
    let text = l.text.replace(/\s+/g, ' ').trim();
    if (text === '') continue;
    const date = leadingDateOf(text, period, period.end);
    if (date) {
      text = text.slice(date.length);
      const time = LEADING_TIME.exec(text);
      if (time) text = text.slice(time[0].length);
      dates.push({ iso: date.iso, x, y, time: time?.[1] ?? null });
      if (text === '') continue;
    }
    const whole = AMOUNT.exec(text);
    const found = whole ? amountFrom(whole, currency) : null;
    if (found) {
      amounts.push({ ...found, text, x, right, y });
      continue;
    }
    const tail = TRAILING.exec(text);
    const trailing = tail ? amountFrom(tail, currency) : null;
    if (tail && trailing) {
      amounts.push({ ...trailing, text: text.slice(tail.index), x, right, y });
      text = text.slice(0, tail.index).trim();
    }
    if (text === '') continue;
    if (TIME.test(text)) times.push({ time: text, x, y });
    else texts.push({ text, x, right, y });
  }
  dates.sort((a, b) => a.y - b.y);

  // Where the list prints money with a currency mark, the amounts stand in one column: a bare figure (no separator, no
  // mark) away from every marked amount's edges is a cell's words (the end of a wrapped id, say), not an amount. A
  // figure with a separator stays an amount wherever it stands: a bank prints Rp on its balance line and on no row.
  const marked = amounts.filter((a) => a.marked);
  for (let i = amounts.length - 1; i >= 0 && marked.length > 0; i -= 1) {
    const a = amounts[i]!;
    if (a.marked || !a.bare || marked.some((m) => Math.abs(m.right - a.right) <= 0.03 || Math.abs(m.x - a.x) <= 0.03)) continue;
    texts.push({ text: a.text, x: a.x, right: a.right, y: a.y });
    amounts.splice(i, 1);
  }

  // A time on a line of its own, under the date or beside it, is that date's.
  for (const d of dates) {
    if (d.time !== null) continue;
    const k = times.findIndex((t) => (Math.abs(t.x - d.x) <= SAME_EDGE && t.y > d.y && t.y - d.y <= 2 * median) || (t.x > d.x && Math.abs(t.y - d.y) <= 0.5 * median));
    if (k >= 0) d.time = times.splice(k, 1)[0]!.time;
  }

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

  // Above the first entry stands the list's heading row, when the screenshot caught it: a line there joins that entry
  // only as near above it as the other entries' lines stand above theirs (a line's height and a half at the least),
  // and a heading's word never does. With no other entry to measure by, as far as any line joins an entry. The
  // headings kept say where the columns are.
  const headings = new Map<keyof typeof HEADINGS, number>();
  const first = records.reduce<(typeof records)[number] | null>((top, r) => (top === null || r.lo < top.lo ? r : top), null);
  if (first) {
    const above = (r: (typeof records)[number]) => r.pieces.reduce((most, p) => Math.max(most, r.lo - p.y), 0);
    const allowance = records.length === 1 ? reach : Math.max(1.5 * median, ...records.filter((r) => r !== first).map(above));
    first.pieces = first.pieces.filter((p) => p.y >= first.lo || (headingOf(p.text) === null && first.lo - p.y <= allowance));
    for (const p of texts) {
      const heading = headingOf(p.text);
      if (heading && p.y < first.lo && !headings.has(heading)) headings.set(heading, p.x);
    }
  }

  const idAt = headings.get('reference');
  const entries = records.map((r) => {
    const columns = columnsOf(r.pieces).map((c) => readColumn(c, median, idAt !== undefined && Math.abs(c[0]!.x - idAt) <= COLUMN_REACH));
    return { r, columns, text: columns.filter((c) => c.words.length > 0) };
  });
  // A table's transaction text stands in one column: where the heading names it, or where the entries of more than one
  // column of words start their words (most of them; one is enough). An entry whose words all stand right of it has no
  // transaction text: its payment cell is never taken for the note.
  const starts = entries.filter((e) => e.text.length > 1).map((e) => e.text[0]!.x).sort((a, b) => a - b);
  const descriptionAt = headings.get('description') ?? (starts.length >= 1 ? starts[Math.floor(starts.length / 2)]! : undefined);

  return entries.map(({ r, columns, text }): Found => {
    const ref = columns.find((c) => c.ref !== null)?.ref ?? null;
    let description = '';
    let rest: string[] = [];
    if (text.length === 0) {
      // A date and an amount alone: nothing to describe it.
    } else if (descriptionAt === undefined && text.length === 1) {
      // No columns to go by: the first line is the description and the rest what it was paid from.
      [description = '', ...rest] = text[0]!.words;
    } else {
      const near = text.map((c, i) => ({ i, gap: Math.abs(c.x - (descriptionAt ?? c.x)) })).sort((a, b) => a.gap - b.gap)[0];
      const at =
        descriptionAt === undefined ? 0 : near && near.gap <= COLUMN_REACH ? near.i : text.every((c) => c.x > descriptionAt) ? -1 : 0;
      if (at >= 0) description = text[at]!.words.join(' ');
      rest = text.filter((_, i) => i !== at).map((c) => c.words.join(' '));
    }
    return {
      on: r.date.iso,
      time: r.date.time,
      description,
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
 * Every entry of a list once, in the order printed, from the screenshots' Vision lines, leaving out those paid in coins. `today` places a date that
 * prints no year within the year before it; `currency` is the account's.
 */
export function readTransactionList(images: readonly CaptureLine[][], opts: { today: string; currency: string }): ListReading {
  const end = Date.parse(`${opts.today}T00:00:00Z`);
  const period = { start: isoDay(end - 366 * DAY_MS), end: opts.today };
  const emptyImages: number[] = [];
  const perImage = images.map((lines, i) => readImage(lines, i, period, opts.currency));
  // A figure with no currency mark and no separator is coins when the list marks the rest in money. A source naming coins
  // or points makes a row coins when its figure carries no currency mark, or when the source is coins alone: a row with
  // Rp paid partly in coins, or one that earned points, is money and is never dropped. The description is never asked:
  // a shop may have such a word in its name.
  const anyMarked = perImage.some((found) => found.some((r) => r.marked));
  const rows: ListRow[] = [];
  const seen = new Set<string>();
  let previous: ListRow[] = [];
  perImage.forEach((found, image) => {
    const clean: ListRow[] = found.map(({ marked, ...row }) => {
      const source = row.source?.trim() ?? '';
      return { ...row, coins: (row.coins && anyMarked) || (COIN_WORDS.test(source) && (!marked || COINS_ONLY.test(source))) };
    });
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
      // A row paid in coins or points is no money of the account's: it is left out of the reading entirely, though it
      // still counts for the overlap of screenshots and for a screenshot having been read.
      if (row.coins) continue;
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
