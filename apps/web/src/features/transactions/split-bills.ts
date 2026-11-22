import { monthName } from '@expanses/core';
import type { BillChoice } from '@expanses/db';
import type { SplitBill, SplitRow } from './tx-form';

/*
 * One payment, several bills (2026-11-22): a split's part may pay a month of a recurring bill — the Split sheet's
 * Bill row. These are its rules, kept off the screen so they can be read and tested on their own.
 */

/** "Mobile phone · Nov": a bill and its month, as a part names it. */
export function billLabel(bill: Pick<SplitBill, 'billMonth'> & { name: string }): string {
  return `${bill.name} · ${monthName(bill.billMonth, 'short')}`;
}

const same = (a: Pick<SplitBill, 'templateId' | 'billMonth'>, b: Pick<SplitBill, 'templateId' | 'billMonth'>) => a.templateId === b.templateId && a.billMonth === b.billMonth;

/**
 * What a part's Bill list offers: the bills not paid yet for the purchase's month (and the months this purchase already
 * pays), less those another part already pays — the part's own bill stays. Bills in the part's own category first,
 * then the rest, each group by name.
 */
export function billChoicesForPart(choices: readonly BillChoice[], splits: readonly SplitRow[], index: number): BillChoice[] {
  const part = splits[index];
  if (!part) return [];
  const taken = splits.flatMap((row, i) => (i !== index && row.bill ? [row.bill] : []));
  const open = choices.filter((choice) => !taken.some((bill) => same(bill, choice)));
  const mine = open.filter((choice) => choice.categoryAccountId === part.categoryId);
  return [...mine, ...open.filter((choice) => choice.categoryAccountId !== part.categoryId)];
}

/** The rows with row `index` paying `bill`, or none (`null`). Every other part, and every other fact of this one, stays. */
export function withPartBill(splits: readonly SplitRow[], index: number, bill: Pick<SplitBill, 'templateId' | 'billMonth'> | null): SplitRow[] {
  return splits.map((row, i) => {
    if (i !== index) return bill && row.bill && same(row.bill, bill) ? withoutBill(row) : row;
    if (!bill) return withoutBill(row);
    return { ...row, bill: { templateId: bill.templateId, billMonth: bill.billMonth } };
  });
}

function withoutBill(row: SplitRow): SplitRow {
  const { bill: _was, ...rest } = row;
  void _was;
  return rest;
}

/** A part's bill named, by the choices and the bills known, or null when neither knows it (a bill since stopped). */
export function partBillLabel(bill: SplitBill | null | undefined, choices: readonly BillChoice[], names: ReadonlyMap<string, string>): string | null {
  if (!bill) return null;
  const name = choices.find((choice) => choice.templateId === bill.templateId)?.name ?? names.get(bill.templateId);
  return name ? billLabel({ name, billMonth: bill.billMonth }) : null;
}
