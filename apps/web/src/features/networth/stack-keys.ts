import { SHEET_SECTION_LABELS, type SheetSectionKey } from '@expanses/core';
import type { LiabilityKind } from '@expanses/db';
import { SUBTYPE_LABELS } from '../../lib/account-types';

/**
 * One thing a stack is made of: what it is called, and the two classes it is drawn with.
 *
 * Two classes because the same money is drawn in two worlds — the sheet's own bars and the swatches in a key are boxes,
 * and the chart's bars are paint — and both are the same Tailwind colour, so the key under the chart and the blocks in
 * it cannot drift apart.
 */
export interface StackKey {
  key: string;
  label: string;
  /** For a box: the sheet's share bar, the swatch in a key. */
  className: string;
  /** For paint: a bar in the drawing. */
  fill: string;
}

/**
 * What the chart stacks, in the order it stacks it: what you own first, out from nothing, then what you owe under it.
 *
 * The assets keep the sheet's own colours, because they are the sheet's own families — the key under the chart is the
 * key beside the columns, and the same money is the same colour on both screens. What is owed is one family in three
 * sizes, so a debt reads as a debt first and as its kind second.
 */
export const ASSET_STACK_KEYS: readonly StackKey[] = [
  { key: 'liquid', label: SHEET_SECTION_LABELS.liquid, className: 'bg-cyan-600', fill: 'fill-cyan-600' },
  { key: 'invest', label: SHEET_SECTION_LABELS.invest, className: 'bg-emerald-600', fill: 'fill-emerald-600' },
  { key: 'use', label: SHEET_SECTION_LABELS.use, className: 'bg-slate-400', fill: 'fill-slate-400' },
  { key: 'other', label: SHEET_SECTION_LABELS.other, className: 'bg-amber-500', fill: 'fill-amber-500' },
];

export const DEBT_STACK_KEYS: readonly StackKey[] = [
  { key: 'credit_card', label: SUBTYPE_LABELS.credit_card, className: 'bg-rose-500', fill: 'fill-rose-500' },
  { key: 'loan', label: SUBTYPE_LABELS.loan, className: 'bg-rose-800', fill: 'fill-rose-800' },
  { key: 'payable', label: SUBTYPE_LABELS.payable, className: 'bg-rose-300', fill: 'fill-rose-300' },
];

/** Both sides in one list, which is what the key under the chart reads. */
export const STACK_KEYS: readonly StackKey[] = [...ASSET_STACK_KEYS, ...DEBT_STACK_KEYS];

/** The colour each family is drawn in, for the parts of the page that are boxes rather than paint. */
export function stackColours(keys: readonly StackKey[]): Record<string, string> {
  return Object.fromEntries(keys.map((key) => [key.key, key.className]));
}

/** The keys the series stacks by, named where the record it hands over is read. */
export type AssetStackKey = SheetSectionKey;
export type DebtStackKey = LiabilityKind;
