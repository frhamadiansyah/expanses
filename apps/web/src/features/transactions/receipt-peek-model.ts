import { formatMinor } from '@expanses/core';
import type { Classified } from './classify';
import type { ReceiptLine } from './receipt-view';

/**
 * The Mac receipt (the side peek a row opens on a wide screen), as data: the phone receipt's lines turned into the
 * peek's label-and-value rows, in the receipt's own order and by its own rules (`useReceipt`, `receiptLines`). The
 * receipt's groups — Bill and Paid off, Instalments, Past purchase — follow its lines as rows too, since a peek is one
 * column of rows rather than a page of groups.
 */
export interface PeekLine {
  key: string;
  label: string;
  value: string;
  /** A second, grey line under the value: the market beside a transfer's Rate. */
  detail?: string;
  /** muted: a value said in grey (None, Counts as); points: the programme's green. */
  tone?: 'muted' | 'points';
  /** What a click on the row does: open the bill (or the bill list), the instalments (plan or Turn into), or flip Paid off. */
  action?: 'bill' | 'instalments' | 'paid-off';
  /** For Paid off: whether it is on. */
  on?: boolean;
  testId?: string;
}

export interface PeekLinesInput {
  /** The category (its names, joined), or what the row is when it is none: "Transfer", "Opening balance". */
  category: string;
  /** The receipt's own lines (`receiptLines`), in its order. */
  lines: readonly ReceiptLine[];
  /** Essential or Lifestyle, for spending; null for anything else. */
  countsAs: string | null;
  /** The workspace the row is filed in, when known. */
  workspace: string | null;
  /** The receipt's Bill row: Linked or None, or null when the receipt has no Bill row. */
  bill: 'Linked' | 'None' | null;
  /** The receipt's Paid off (or Settled, for a refund) switch, when it carries one. */
  paidOff: { label: string; on: boolean } | null;
  /** The receipt's Instalments row ("None", "6 × Rp 500.000"), when it has one. */
  instalments: string | null;
  /** A past purchase on a money account: the receipt's "Past purchase · Balance unchanged". */
  past: boolean;
}

/** The peek's rows: Category, then every receipt line in the receipt's order, then the receipt's groups as rows. */
export function receiptPeekLines(input: PeekLinesInput): PeekLine[] {
  const rows: PeekLine[] = [{ key: 'category', label: 'Category', value: input.category }];
  input.lines.forEach((line, i) =>
    rows.push({ key: `line:${i}:${line.label}`, label: line.label, value: line.value, ...(line.detail ? { detail: line.detail } : {}), ...(line.tone === 'points' ? { tone: 'points' as const } : {}) }),
  );
  if (input.countsAs) rows.push({ key: 'counts', label: 'Counts as', value: input.countsAs, tone: 'muted' });
  if (input.workspace) rows.push({ key: 'workspace', label: 'Workspace', value: input.workspace });
  if (input.bill) rows.push({ key: 'bill', label: 'Bill', value: input.bill, action: 'bill', testId: 'receipt-bill', ...(input.bill === 'None' ? { tone: 'muted' as const } : {}) });
  if (input.paidOff) rows.push({ key: 'paid-off', label: input.paidOff.label, value: input.paidOff.on ? 'On' : 'Off', action: 'paid-off', on: input.paidOff.on });
  if (input.instalments !== null)
    rows.push({ key: 'instalments', label: 'Instalments', value: input.instalments, action: 'instalments', testId: 'receipt-instalments', ...(input.instalments === 'None' ? { tone: 'muted' as const } : {}) });
  if (input.past) rows.push({ key: 'past', label: 'Past purchase', value: 'Balance unchanged', testId: 'receipt-past' });
  return rows;
}

/** What a row is when it has no category: the words the Cashflow table uses. */
export function kindWord(type: Classified['type']): string | null {
  switch (type) {
    case 'transfer':
      return 'Transfer';
    case 'opening':
      return 'Opening balance';
    case 'correction':
      return 'Balance correction';
    default:
      return null;
  }
}

/**
 * The peek's figure: the receipt's hero figure, with the Mac tables' + on money in (income, or money back on a
 * purchase). A transfer reads as what landed, unsigned.
 */
export function peekFigure(kind: Pick<Classified, 'type' | 'amountMinor' | 'currency'>): { text: string; income: boolean } {
  const income = kind.type === 'income' || (kind.type === 'expense' && kind.amountMinor < 0);
  return { text: `${income ? '+' : ''}${formatMinor(Math.abs(kind.amountMinor), kind.currency)}`, income };
}
