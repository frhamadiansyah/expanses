import type { TransactionView } from '@expanses/db';

export type TransactionType = 'expense' | 'income' | 'transfer' | 'opening';

export interface Classified {
  type: TransactionType;
  amountMinor: number;
  currency: string;
  categoryIds: string[];
  /**
   * The money accounts, in the order the money moved: what it left first, what it landed in second. A row
   * joining these with an arrow reads the way a statement does, and it is the signs that decide, never the
   * order the entries happen to be written in — a transfer posts [into, out of], a cross-currency one [out of,
   * into], and a buy [holding, cash], while the money only ever went one way.
   */
  moneyAccountNames: string[];
}

export function classify(tx: TransactionView): Classified {
  const money = tx.entries.filter((e) => e.accountKind === 'asset' || e.accountKind === 'liability');
  const expenses = tx.entries.filter((e) => e.accountKind === 'expense');
  const incomes = tx.entries.filter((e) => e.accountKind === 'income');
  const equity = tx.entries.filter((e) => e.accountKind === 'equity');
  // Sorted by sign: the credit (the account the money came out of) first, then the debit it reached.
  const names = [...new Set([...money].sort((a, b) => a.amountMinor - b.amountMinor).map((e) => e.accountName))];

  if (expenses.length > 0) {
    return { type: 'expense', amountMinor: expenses.reduce((s, e) => s + e.amountMinor, 0), currency: expenses[0]!.currency, categoryIds: expenses.map((e) => e.accountId), moneyAccountNames: names };
  }
  if (incomes.length > 0) {
    return { type: 'income', amountMinor: -incomes.reduce((s, e) => s + e.amountMinor, 0), currency: incomes[0]!.currency, categoryIds: incomes.map((e) => e.accountId), moneyAccountNames: names };
  }
  const into = money.find((e) => e.amountMinor > 0) ?? money[0] ?? tx.entries[0]!;
  const isOpening = equity.length > 0 && money.length === 1;
  return { type: isOpening ? 'opening' : 'transfer', amountMinor: Math.abs(into.amountMinor), currency: into.currency, categoryIds: [], moneyAccountNames: names };
}
