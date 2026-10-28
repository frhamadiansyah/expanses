import { type ChargeKind, minorToMajorString, type ReceiptLinesReading, type ReceiptShares, splitReceipt } from '@expanses/core';
import type { FormDraft, WithRow } from './tx-form';
import { peopleOn } from './tx-form';

/**
 * A restaurant bill being divided: the dishes and charges read from its photo (and fixed by hand), who shared each,
 * and how each charge is shared. Plain data, kept on the draft so Edit can reopen it exactly as it was left.
 */
export interface MemoItem {
  id: string;
  name: string;
  quantity: number;
  amountMinor: number;
  /** Indexes into the people on the bill; 0 is Me. Empty is everybody. */
  sharedBy: number[];
}

export interface MemoCharge {
  id: string;
  label: string;
  kind: ChargeKind;
  /** Negative for a discount. */
  amountMinor: number;
  mode: 'pro-rata' | 'equal';
}

export interface ReceiptMemo {
  items: MemoItem[];
  charges: MemoCharge[];
  /** The total the receipt printed; null when none was read. */
  printedTotal: number | null;
  /** The owner chose to make the difference an extra charge called Other, so the bill is the printed total. */
  useTotal: boolean;
  /** How "Other" is shared; pro rata unless changed. */
  otherMode?: 'pro-rata' | 'equal';
  merchant: string | null;
  date: string | null;
  currency: string;
  /** Everybody but Me, in the order they sit on the bill: index 1 onward in `sharedBy`. */
  people: { debtAccountId: string; name: string }[];
}

let counter = 0;
const newId = () => `r${Date.now().toString(36)}${(counter += 1)}`;

/** A fresh bill from what was read, with every dish shared by everybody until someone is tagged. */
export function memoFromReading(reading: ReceiptLinesReading, currency: string, people: readonly WithRow[]): ReceiptMemo {
  return {
    items: reading.items.map((item) => ({ id: newId(), name: item.name, quantity: item.quantity, amountMinor: item.amountMinor, sharedBy: [] })),
    charges: reading.charges.map((charge) => ({ id: newId(), label: charge.label, kind: charge.kind, amountMinor: charge.amountMinor, mode: 'pro-rata' as const })),
    printedTotal: reading.total,
    useTotal: false,
    merchant: reading.merchant,
    date: reading.date,
    currency,
    people: people.map((row) => ({ debtAccountId: row.debtAccountId, name: row.name })),
  };
}

export const newItemId = newId;

const sumOf = (xs: readonly { amountMinor: number }[]) => xs.reduce((s, x) => s + x.amountMinor, 0);

/** The printed total minus the dishes and charges: what is unexplained. Null when the receipt printed no total. */
export function mismatchOf(memo: ReceiptMemo): number | null {
  return memo.printedTotal === null ? null : memo.printedTotal - sumOf(memo.items) - sumOf(memo.charges);
}

/** The charges that count: those read, and "Other" for the difference when the owner chose the receipt's total. */
export function effectiveCharges(memo: ReceiptMemo): MemoCharge[] {
  const gap = mismatchOf(memo);
  if (!memo.useTotal || gap === null || gap === 0) return memo.charges;
  return [...memo.charges, { id: 'other', label: 'Other', kind: 'other', amountMinor: gap, mode: memo.otherMode ?? 'pro-rata' }];
}

/** What the bill comes to as divided: dishes plus every counted charge. */
export function billOf(memo: ReceiptMemo): number {
  return sumOf(memo.items) + sumOf(effectiveCharges(memo));
}

/** Whether the amounts can be used: something to divide, and nothing left unexplained. */
export function usable(memo: ReceiptMemo): boolean {
  if (memo.items.length === 0 || billOf(memo) <= 0) return false;
  const gap = mismatchOf(memo);
  return gap === null || gap === 0 || memo.useTotal;
}

/** Each person's share, Me first. */
export function sharesOf(memo: ReceiptMemo): ReceiptShares {
  return splitReceipt(
    memo.people.length + 1,
    memo.items.map((item) => ({ amountMinor: item.amountMinor, sharedBy: item.sharedBy })),
    effectiveCharges(memo).map((charge) => ({ amountMinor: charge.amountMinor, mode: charge.mode })),
  );
}

/** A dish tagged for one more or one fewer person. */
export function toggleSharer(item: MemoItem, person: number): MemoItem {
  const has = item.sharedBy.includes(person);
  return { ...item, sharedBy: has ? item.sharedBy.filter((p) => p !== person) : [...item.sharedBy, person].sort((a, b) => a - b) };
}

/**
 * The form with the receipt's amounts in it: the bill is the receipt's, each person who owes something is a With row
 * with their custom amount, and Me is what is left. Somebody with no share is left off the bill (a row of zero would
 * be refused on Save); the memo still remembers them for Edit. The note and the day are filled only where empty.
 */
export function withReceiptApplied(draft: FormDraft, memo: ReceiptMemo, today: string): FormDraft {
  const shares = sharesOf(memo);
  const rows: WithRow[] = [];
  memo.people.forEach((person, i) => {
    const owed = shares.totals[i + 1] ?? 0;
    if (owed > 0) rows.push({ debtAccountId: person.debtAccountId, name: person.name, amount: minorToMajorString(owed, memo.currency) });
  });
  return {
    ...draft,
    amount: minorToMajorString(billOf(memo), memo.currency),
    currency: memo.currency,
    with: rows,
    withEqually: false,
    receiptSplit: memo,
    description: draft.description.trim() === '' ? (memo.merchant ?? 'Receipt') : draft.description,
    occurredOn: memo.date && draft.occurredOn === today && memo.date < today ? memo.date : draft.occurredOn,
  };
}

/** The people on the draft as the memo wants them. */
export const memoPeople = (draft: FormDraft) => peopleOn(draft).map((row) => ({ debtAccountId: row.debtAccountId, name: row.name }));
