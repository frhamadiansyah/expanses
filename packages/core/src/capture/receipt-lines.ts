import { isSupportedCurrency } from '../money/currencies';
import { findDateTime } from './date';
import { figureMinor, merchantOf } from './receipt';
import {
  ADDRESS_STARTS,
  CHARGE_WORDS,
  type ChargeKind,
  NOT_TOTAL_WORDS,
  PASS_OVER_WORDS,
  SUBTOTAL_WORDS,
  TOTAL_WORDS,
} from './receipt-words';
import type { CaptureLine } from './types';

/** One dish or drink on a bill. */
export interface ReceiptItem {
  name: string;
  /** How many were had; 1 when the line did not say. */
  quantity: number;
  /** The line's total in minor units: what the bill charged for all of them. */
  amountMinor: number;
}

/** A line added to or taken off the bill that is not a dish: service, tax, a tip, rounding, a discount (negative). */
export interface ReceiptCharge {
  label: string;
  kind: ChargeKind;
  /** Negative for a discount. */
  amountMinor: number;
}

/** What a bill photographed line by line says. Each part is empty or null when the picture did not say it. */
export interface ReceiptLinesReading {
  items: ReceiptItem[];
  charges: ReceiptCharge[];
  /** The bill's total as printed. */
  total: number | null;
  /** The printed subtotal, when there was one. */
  subtotal: number | null;
  /** The total minus the items and charges: 0 when they agree, null when no total was read. */
  mismatchMinor: number | null;
  /** YYYY-MM-DD. */
  date: string | null;
  merchant: string | null;
  /** Rows that carried a figure and could not be placed as a dish, a charge or the total. */
  unplaced: string[];
}

/*
 * What this does not do. It reads the printed text and nothing about layout beyond "same row": a bill whose names
 * and figures come out as two separate columns (all the names, then all the figures) is not paired, a photo taken
 * at an angle merges or splits rows, a modifier line under a dish ("extra cheese +5.000") is taken as a dish of its
 * own, and a count beside a dish is only seen as "2 x", "x2", a leading count, or a count just before the figure.
 * Whatever it misses shows up as the items not adding to the total, which the screen says and the owner fixes.
 */

const wordPattern = (words: readonly string[]) =>
  new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${[...words]
      .sort((a, b) => b.length - a.length)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'))
      .join('|')})(?![\\p{L}\\p{N}])`,
    'iu',
  );

const CHARGE_PATTERNS = (Object.entries(CHARGE_WORDS) as [Exclude<ChargeKind, 'other'>, readonly string[]][]).map(
  ([kind, words]) => [kind, wordPattern(words)] as const,
);
const GRAND_TOTAL = wordPattern(TOTAL_WORDS[0]!);
const PLAIN_TOTAL = wordPattern(TOTAL_WORDS[1]!);
const SUBTOTAL = wordPattern(SUBTOTAL_WORDS);
const NOT_TOTAL = wordPattern(NOT_TOTAL_WORDS);
const PASS_OVER = wordPattern(PASS_OVER_WORDS);
const ADDRESS = new RegExp(`^(?:${ADDRESS_STARTS.join('|')})(?![\\p{L}])`, 'iu');
const TIME = /(?<!\d)\d{1,2}:\d{2}(?::\d{2})?(?!\d)/;
const PHONE = /(?:\+62|\(?0\d{2,3}\)?)[\s-]?\d{3,4}[\s-]?\d{3,5}(?!\d)/;
const PERCENT = /\d+(?:[.,]\d+)?\s*%/g;

const MARK = '(?:S\\$|Rp|IDR|USD|SGD|MYR|EUR|JPY|GBP|RM|\\$|€|¥|£)';
const NUMBER = '\\d{1,3}(?:[.,]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?';
/** The figure that ends a row: an optional sign or bracket, an optional mark, the number, an optional trailing minus. */
const AMOUNT_END = new RegExp(`(?<sign>[-−(])?\\s*(?<mark>${MARK}\\.?\\s*)?(?<num>${NUMBER})\\s*(?<after>[-−)]|CR)?\\s*$`, 'iu');
/** "3 x 9.000": a count and a unit price. */
const COUNT_UNIT = new RegExp(`(?<![\\d.,])(?<count>\\d{1,2})\\s*[x×@]\\s*(?<mark>${MARK}\\.?\\s*)?(?<num>${NUMBER})(?![\\d.,])`, 'iu');

interface Figure {
  minor: number;
  /** Where the figure starts in the row. */
  at: number;
  negative: boolean;
}

/** The row's closing figure, or null when it ends in words or in a bare small number (a count, not money). */
function closingFigure(text: string, currency: string): Figure | null {
  const found = AMOUNT_END.exec(text);
  const g = found?.groups;
  if (!found || !g) return null;
  const num = g.num!;
  // A lone digit or two is a count or a table number; money is grouped, has cents, wears a mark, or is three digits.
  if (/^\d+$/.test(num) && num.length < 3 && !g.mark) return null;
  const numAt = found.index + found[0].indexOf(num);
  // "x3": a count, not money.
  if (/(?<![\p{L}])[x×@]\s*$/iu.test(text.slice(0, numAt)) && !g.mark) return null;
  const negative = g.sign === '-' || g.sign === '−' || g.after === '-' || g.after === '−' || (g.sign === '(' && g.after === ')');
  return { minor: figureMinor(num, currency), at: found.index, negative };
}

/** Rows: lines that sit at the same height are one row, left to right. */
function rowsOf(lines: readonly CaptureLine[]): string[] {
  const kept = lines.filter((line) => line.text.trim() !== '');
  const centre = (line: CaptureLine) => line.box[1] + line.box[3] / 2;
  const tallOf = (line: CaptureLine) => Math.max(line.height, line.box[3], 0.001);
  const ordered = [...kept].sort((a, b) => centre(a) - centre(b) || a.box[0] - b.box[0]);
  const rows: CaptureLine[][] = [];
  for (const line of ordered) {
    const row = rows[rows.length - 1];
    if (row) {
      const mid = row.reduce((sum, member) => sum + centre(member), 0) / row.length;
      const rowTall = Math.min(...row.map(tallOf));
      if (Math.abs(centre(line) - mid) <= Math.min(tallOf(line), rowTall) * 0.5) {
        row.push(line);
        continue;
      }
    }
    rows.push([line]);
  }
  return rows.map((row) =>
    [...row]
      .sort((a, b) => a.box[0] - b.box[0])
      .map((line) => line.text.trim())
      .join('  '),
  );
}

const letters = (text: string) => text.replace(/[^\p{L}]/gu, '').length;
const tidy = (text: string) =>
  text
    .replace(/[.\u2026_:·•*#=~]{2,}/g, ' ')
    .replace(/^[\s\-–—.,:;*#=~]+|[\s\-–—.,:;*#=~]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

function chargeKindOf(text: string): ChargeKind | null {
  for (const [kind, pattern] of CHARGE_PATTERNS) if (pattern.test(text)) return kind;
  return null;
}

/** A dish row taken apart: name, count and line total (null when the row carries no figure). */
function dishOf(text: string, currency: string): { name: string; quantity: number; amountMinor: number | null; negative: boolean } {
  let rest = text.trim();
  let quantity = 1;
  let unit: number | null = null;

  const pair = COUNT_UNIT.exec(rest);
  if (pair?.groups) {
    quantity = Number(pair.groups.count);
    unit = figureMinor(pair.groups.num!, currency);
    rest = `${rest.slice(0, pair.index)} ${rest.slice(pair.index + pair[0].length)}`.trim();
  }

  const closing = closingFigure(rest, currency);
  let amountMinor: number | null = null;
  let negative = false;
  if (closing) {
    amountMinor = closing.minor;
    negative = closing.negative;
    rest = rest.slice(0, closing.at).trim();
  } else if (unit !== null) {
    amountMinor = quantity * unit;
  }

  if (pair === null) {
    const leading = /^(\d{1,2})\s*[x×]\s*(?=\p{L})|^(\d{1,2})\s+(?=\p{L})/u.exec(rest);
    const trailing = /\s[x×]\s*(\d{1,2})$/iu.exec(rest);
    const beforeFigure = closing ? /\s(\d{1,2})$/.exec(rest) : null;
    if (leading) {
      quantity = Number(leading[1] ?? leading[2]);
      rest = rest.slice(leading[0].length);
    } else if (trailing) {
      quantity = Number(trailing[1]);
      rest = rest.slice(0, trailing.index);
    } else if (beforeFigure && letters(rest) >= 2 && Number(beforeFigure[1]) <= 20) {
      quantity = Number(beforeFigure[1]);
      rest = rest.slice(0, beforeFigure.index);
    }
  }
  return { name: tidy(rest.replace(PERCENT, ' ')), quantity: Math.max(1, quantity), amountMinor, negative };
}

/**
 * Reads a bill photographed line by line into dishes, charges and the total, with a check that they add up. Pure: it
 * takes what Vision read and says what it found; whatever it is unsure of is left for the owner to fix
 * (`mismatchMinor`, `unplaced`).
 *
 * `currency` scales the figures; a dot is a thousands mark and a comma the decimal mark, as everywhere in the app.
 */
export function readReceiptLines(lines: readonly CaptureLine[], currency: string): ReceiptLinesReading {
  const code = isSupportedCurrency(currency) ? currency : 'IDR';
  const items: ReceiptItem[] = [];
  const charges: ReceiptCharge[] = [];
  const unplaced: string[] = [];
  const dates: string[] = [];
  let total: number | null = null;
  let totalRank = 0;
  let subtotal: number | null = null;
  // A row of words whose figure may be on the row below it.
  let waiting: string | null = null;

  function classify(text: string): void {
    const figure = closingFigure(text, code);
    const label = figure ? text.slice(0, figure.at) : text;

    if (SUBTOTAL.test(label)) {
      if (figure) {
        subtotal = figure.minor;
        waiting = null;
      } else waiting = text;
      return;
    }
    if (NOT_TOTAL.test(label) && !chargeKindOf(label)) {
      waiting = null;
      return;
    }
    const grand = GRAND_TOTAL.test(label);
    // "Total tax 17.850" is a charge that says total, not the total.
    if (grand || (PLAIN_TOTAL.test(label) && chargeKindOf(label) === null)) {
      if (figure) {
        const rank = grand ? 2 : 1;
        if (rank >= totalRank) {
          total = figure.minor;
          totalRank = rank;
        }
        waiting = null;
      } else waiting = text;
      return;
    }
    const kind = chargeKindOf(label);
    if (kind) {
      if (figure) {
        const negative = kind === 'discount' || figure.negative;
        charges.push({ label: tidy(label) || 'Charge', kind, amountMinor: negative ? -figure.minor : figure.minor });
        waiting = null;
      } else waiting = text;
      return;
    }
    if (PASS_OVER.test(label)) {
      waiting = null;
      return;
    }
    const dish = dishOf(text, code);
    if (dish.amountMinor !== null && letters(dish.name) >= 2) {
      items.push({ name: dish.name, quantity: dish.quantity, amountMinor: dish.negative ? -dish.amountMinor : dish.amountMinor });
      waiting = null;
      return;
    }
    waiting = dish.amountMinor === null && letters(label) >= 2 ? text : null;
  }

  for (const row of rowsOf(lines)) {
    const text = row.trim();
    const day = findDateTime(text);
    if (day) {
      dates.push(day.slice(0, 10));
      waiting = null;
      continue;
    }
    if (TIME.test(text) || PHONE.test(text) || ADDRESS.test(text) || /@|https?:|www\./i.test(text)) {
      waiting = null;
      continue;
    }
    const figure = closingFigure(text, code);
    const label = figure ? text.slice(0, figure.at) : text;
    if (letters(label) < 2) {
      // Figures only: they belong to the words above ("3 x 9.000   27.000" under its dish, "17.850" under "PPN 10%").
      if (waiting !== null && (figure || COUNT_UNIT.test(text))) {
        const held = waiting;
        waiting = null;
        classify(`${held}  ${text}`);
      } else if (figure) unplaced.push(text);
      continue;
    }
    classify(text);
  }

  const sum = items.reduce((s, item) => s + item.amountMinor, 0) + charges.reduce((s, charge) => s + charge.amountMinor, 0);
  return {
    items,
    charges,
    total,
    subtotal,
    mismatchMinor: total === null ? null : total - sum,
    date: dates[0] ?? null,
    merchant: merchantOf(lines.map((line) => line.text.trim()).filter(Boolean)),
    unplaced,
  };
}
