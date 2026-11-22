import { evaluateAmount, formatMinor, groupedMajorString, proportionalMinor } from '@expanses/core';
import type { SplitRow } from './tx-form';

/**
 * A split by category with a known total keeps one part as the **Rest**: its figure is never typed, it is the total
 * less every other part, worked out again whenever anything else changes. The Rest is the last part until a person
 * types a figure into it by hand — that fixes it, and the part before it takes over as the Rest. The Rest row carries
 * `rest: true`, so the draft remembers which part it is and Save can work it out again if the total moved while the
 * sheet was shut.
 *
 * Everything here is in minor units of the account's own currency, read with `evaluateAmount` (the one reader of a
 * typed figure) and written back with `groupedMajorString`, so a currency with 0, 2 or 3 decimals round-trips whole
 * and the Rest — the total less the others, to the minor unit — absorbs every rounding.
 *
 * **A purchase in another currency** (the flag on USD, the account charged in rupiah) gives each part two figures: the
 * one that posts, in the account's currency (`amount`), and the part's share of the foreign figure (`original`). A part
 * is typed in either; the other is worked out at the whole charge's own rate — charged ÷ original — and `typedOriginal`
 * says which was typed (the last one typed wins). The Rest takes what is left in both, so the parts add up exactly to
 * the charged figure and to the foreign one. `ForeignTotal` carries the foreign whole; without it nothing here changes.
 */

/** The whole purchase in the flag's currency, in that currency's minor units — what the parts' `original` figures divide. */
export interface ForeignTotal {
  currency: string;
  total: number;
}

/** The purchase amount as a total to divide: its figure when it reads and is more than nothing, otherwise null (no Rest then). */
export function splitTotal(amount: string, currency: string): number | null {
  if (!amount.trim()) return null;
  const minor = evaluateAmount(amount, currency);
  return minor !== null && minor > 0 ? minor : null;
}

const minorOf = (row: SplitRow, currency: string): number => (row.amount.trim() ? (evaluateAmount(row.amount, currency) ?? 0) : 0);
const originalOf = (row: SplitRow, currency: string): number => (row.original?.trim() ? (evaluateAmount(row.original, currency) ?? 0) : 0);

/** `minor` as text in `currency`: the text already there when it says the same figure, so typing is never rewritten. */
const put = (text: string | undefined, minor: number, currency: string): string =>
  text?.trim() && evaluateAmount(text, currency) === minor ? text : groupedMajorString(minor, currency);

/**
 * A part's other figure, worked out from the one typed at the whole charge's rate (`total` charged for `foreign.total`).
 * A figure that does not read yet (half typed) leaves the other as it was.
 */
function derive(row: SplitRow, total: number, currency: string, foreign: ForeignTotal): SplitRow {
  if (row.typedOriginal) {
    if (!row.original?.trim()) return { ...row, amount: '' };
    const typed = evaluateAmount(row.original, foreign.currency);
    return typed === null ? row : { ...row, amount: put(row.amount, proportionalMinor(typed, foreign.total, total), currency) };
  }
  if (!row.amount.trim()) return { ...row, original: '' };
  const typed = evaluateAmount(row.amount, currency);
  return typed === null ? row : { ...row, original: put(row.original, proportionalMinor(typed, total, foreign.total), foreign.currency) };
}

/** The index of the Rest part: the one marked, else the last; -1 with no parts. */
export function restIndex(splits: readonly SplitRow[]): number {
  const marked = splits.findIndex((row) => row.rest);
  return marked >= 0 ? marked : splits.length - 1;
}

/** The parts with only part `index` marked as the Rest. */
function mark(splits: readonly SplitRow[], index: number): SplitRow[] {
  return splits.map((row, i) => {
    const { rest: _was, ...plain } = row;
    void _was;
    if (i !== index) return plain;
    // The Rest is never typed, in either figure.
    const { typedOriginal: _typed, ...rest } = plain;
    void _typed;
    return { ...rest, rest: true };
  });
}

/** What the parts add up to, leaving out those at `skip`. */
function sumExcept(splits: readonly SplitRow[], skip: number, currency: string): number {
  return splits.reduce((sum, row, i) => (i === skip ? sum : sum + minorOf(row, currency)), 0);
}

/**
 * The parts with the Rest worked out against `total`: marked as the Rest and set to the total less the others. Where the
 * others already reach past the total the Rest is left empty (`assignment` then says by how much). Without a total, or
 * with no parts, nothing changes. A figure already right is left as typed, so opening a sheet changes nothing.
 */
export function settleRest(splits: readonly SplitRow[], total: number | null, currency: string, foreign: ForeignTotal | null = null): SplitRow[] {
  if (total === null || splits.length === 0) return splits.slice();
  if (foreign) return settleBoth(splits, total, currency, foreign);
  const at = restIndex(splits);
  const rest = total - sumExcept(splits, at, currency);
  const marked = mark(splits, at);
  const current = marked[at]!.amount.trim() ? evaluateAmount(marked[at]!.amount, currency) : null;
  if (rest >= 0 && current === rest) return marked;
  const amount = rest < 0 ? '' : groupedMajorString(rest, currency);
  return marked.map((row, i) => (i === at ? { ...row, amount } : row));
}

/** `settleRest` for a purchase in another currency: every part's other figure worked out, and the Rest left in both. */
function settleBoth(splits: readonly SplitRow[], total: number, currency: string, foreign: ForeignTotal): SplitRow[] {
  const at = restIndex(splits);
  const rows = mark(splits, at).map((row, i) => (i === at ? row : derive(row, total, currency, foreign)));
  const rest = total - sumExcept(rows, at, currency);
  const restOriginal = foreign.total - sumOriginalsExcept(rows, at, foreign.currency);
  const row = rows[at]!;
  rows[at] = {
    ...row,
    amount: rest < 0 ? '' : put(row.amount, rest, currency),
    original: restOriginal < 0 ? '' : put(row.original, restOriginal, foreign.currency),
  };
  return rows;
}

function sumOriginalsExcept(splits: readonly SplitRow[], skip: number, currency: string): number {
  return splits.reduce((sum, row, i) => (i === skip ? sum : sum + originalOf(row, currency)), 0);
}

/**
 * Whether Save has parts to work out again: a Rest to follow the total, or a part typed in the foreign figure whose
 * charged figure follows the rate.
 */
export const needsSettling = (splits: readonly SplitRow[]): boolean => splits.some((row) => row.rest || row.typedOriginal);

/** Whether any part is marked as the Rest — what Save asks before working it out against the total again. */
export const hasRest = (splits: readonly SplitRow[]): boolean => splits.some((row) => row.rest);

/** The words an edit that would leave the Rest below nothing is refused in. */
export const overBy = (minor: number, currency: string): string => `Over by ${formatMinor(minor, currency)}`;

export type RestEdit = { splits: SplitRow[] } | { refusal: string };

/**
 * Part `index` set to the typed `amount`. Another part: the Rest follows. The Rest itself: the typed figure fixes it, and
 * the part before it (the next one, for the first) becomes the Rest. Refused — nothing changes — when the Rest would go
 * below nothing. With no total (or a single part) the figure is simply taken.
 *
 * With `foreign`, `amount` is in the account's currency and the part's foreign figure is worked out from it.
 */
export function editAmount(splits: readonly SplitRow[], index: number, amount: string, total: number | null, currency: string, foreign: ForeignTotal | null = null): RestEdit {
  return edit(splits, index, (row) => {
    const { typedOriginal: _was, ...plain } = row;
    void _was;
    return { ...plain, amount };
  }, total, currency, foreign);
}

/**
 * Part `index`'s foreign figure typed (`foreign.currency`): its figure in the account's currency is worked out from it at
 * the whole charge's rate, and the Rest follows in both — as `editAmount`, from the other side.
 */
export function editOriginal(splits: readonly SplitRow[], index: number, original: string, total: number | null, currency: string, foreign: ForeignTotal): RestEdit {
  return edit(splits, index, (row) => ({ ...row, original, typedOriginal: true }), total, currency, foreign);
}

function edit(splits: readonly SplitRow[], index: number, type: (row: SplitRow) => SplitRow, total: number | null, currency: string, foreign: ForeignTotal | null): RestEdit {
  const typed = splits.map((row, i) => (i === index ? type(row) : row));
  if (total === null || splits.length < 2) return { splits: typed };
  const at = restIndex(splits);
  const rest = index === at ? (at > 0 ? at - 1 : at + 1) : at;
  if (!foreign) {
    const left = total - sumExcept(typed, rest, currency);
    if (left < 0) return { refusal: overBy(-left, currency) };
    return { splits: settleRest(mark(typed, rest), total, currency) };
  }
  const next = settleBoth(mark(typed, rest), total, currency, foreign);
  const left = total - sumExcept(next, rest, currency);
  const leftOriginal = foreign.total - sumOriginalsExcept(next, rest, foreign.currency);
  // Said in the currency just typed in, when that one is over.
  if (next[index]?.typedOriginal && leftOriginal < 0) return { refusal: overBy(-leftOriginal, foreign.currency) };
  if (left < 0) return { refusal: overBy(-left, currency) };
  if (leftOriginal < 0) return { refusal: overBy(-leftOriginal, foreign.currency) };
  return { splits: next };
}

/**
 * One part more. The first split makes two parts, the first carrying the category and figure already on the card; a later
 * one is added last and is the new Rest, while the part that was the Rest keeps the figure it had.
 */
export function addPart(
  splits: readonly SplitRow[],
  card: { categoryId: string; amount: string },
  whole: boolean,
  total: number | null,
  currency: string,
  foreign: ForeignTotal | null = null,
): SplitRow[] {
  const flag = whole ? { excluded: true as const } : {};
  // In another currency the card's amount is the foreign figure: part one takes the whole charge instead.
  const first = foreign && total !== null ? groupedMajorString(total, currency) : card.amount;
  const next: SplitRow[] = splits.length
    ? [...splits, { categoryId: '', amount: '', ...flag }]
    : [{ categoryId: card.categoryId, amount: first, ...flag }, { categoryId: '', amount: '', ...flag }];
  return total === null ? next.map((row) => ({ ...row })) : settleRest(mark(next, next.length - 1), total, currency, foreign);
}

/** Part `index` taken away; the Rest is worked out afresh (the last part, if the Rest itself went). */
export function removePart(splits: readonly SplitRow[], index: number, total: number | null, currency: string, foreign: ForeignTotal | null = null): SplitRow[] {
  const was = restIndex(splits);
  const left = splits.filter((_, i) => i !== index);
  if (left.length === 0 || total === null) return left;
  const keep = was === index ? left.length - 1 : was > index ? was - 1 : was;
  return settleRest(mark(left, keep), total, currency, foreign);
}

export type Assignment = { state: 'assigned' | 'left' | 'over'; minor: number } | null;

/** How much of the total the parts hold: all of it, some left, or over — null without a total to compare to. */
export function assignment(splits: readonly SplitRow[], total: number | null, currency: string): Assignment {
  if (total === null) return null;
  const left = total - splits.reduce((sum, row) => sum + minorOf(row, currency), 0);
  return left === 0 ? { state: 'assigned', minor: 0 } : left > 0 ? { state: 'left', minor: left } : { state: 'over', minor: -left };
}

/** The line under the proportion bar. */
export function assignmentLine(a: Assignment, currency: string): string | null {
  if (!a) return null;
  return a.state === 'assigned' ? 'All of it assigned' : a.state === 'left' ? `${formatMinor(a.minor, currency)} left to assign` : overBy(a.minor, currency);
}

/** Each part's width as a fraction of the bar: its figure over the total (or over what the parts hold, if that is more). */
export function barShares(splits: readonly SplitRow[], total: number | null, currency: string): number[] {
  const amounts = splits.map((row) => Math.max(0, minorOf(row, currency)));
  const whole = Math.max(total ?? 0, amounts.reduce((a, b) => a + b, 0));
  return amounts.map((minor) => (whole > 0 ? minor / whole : 0));
}
