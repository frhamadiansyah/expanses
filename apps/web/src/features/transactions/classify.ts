import { isExchangeResultKey } from '@expanses/core';
import type { TransactionView } from '@expanses/db';

export type TransactionType = 'expense' | 'income' | 'transfer' | 'opening' | 'correction';

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
  /** A transfer's fee, filed as spending beside it (a top-up paid by card); absent on anything else. */
  feeMinor?: number;
}

/** Where money is held: what a transfer moves between, never a holding, a loan or a person. */
const HOLDS_MONEY = new Set(['cash', 'bank', 'savings', 'ewallet', 'fund', 'other_cash', 'credit_card']);

export function classify(tx: TransactionView): Classified {
  const money = tx.entries.filter((e) => e.accountKind === 'asset' || e.accountKind === 'liability');
  // An exchange's gain or loss (withdrawal rate §5, R8) is booked on the transfer it came from; it never makes the
  // transfer read as spending or income, open in the wrong form, or show the wrong figure on its row.
  const expenses = tx.entries.filter((e) => e.accountKind === 'expense' && !isExchangeResultKey(e.accountSystemKey));
  const incomes = tx.entries.filter((e) => e.accountKind === 'income' && !isExchangeResultKey(e.accountSystemKey));
  const equity = tx.entries.filter((e) => e.accountKind === 'equity');
  // Sorted by sign: the credit (the account the money came out of) first, then the debit it reached.
  const names = [...new Set([...money].sort((a, b) => a.amountMinor - b.amountMinor).map((e) => e.accountName))];

  /*
   * A transfer with a fee beside it — GoPay topped up from a card, Rp 1.000.000 landing and Rp 10.000 charged on top —
   * is a transfer: money moved from one place it is held to another, the fee its only spending. A purchase never
   * lands money anywhere; a holding bought, a loan repaid or a bill shared lands it on something that is not money.
   */
  const landed = money.find((e) => e.amountMinor > 0 && HOLDS_MONEY.has(e.accountSubtype ?? ''));
  const left = money.find((e) => e.amountMinor < 0 && e.accountId !== landed?.accountId);
  if (expenses.length > 0 && incomes.length === 0 && equity.length === 0 && landed && left && money.length === 2) {
    return {
      type: 'transfer',
      amountMinor: landed.amountMinor,
      currency: landed.currency,
      categoryIds: expenses.map((e) => e.accountId),
      moneyAccountNames: names,
      feeMinor: expenses.reduce((s, e) => s + e.amountMinor, 0),
    };
  }
  if (expenses.length > 0) {
    return { type: 'expense', amountMinor: expenses.reduce((s, e) => s + e.amountMinor, 0), currency: expenses[0]!.currency, categoryIds: expenses.map((e) => e.accountId), moneyAccountNames: names };
  }
  if (incomes.length > 0) {
    return { type: 'income', amountMinor: -incomes.reduce((s, e) => s + e.amountMinor, 0), currency: incomes[0]!.currency, categoryIds: incomes.map((e) => e.accountId), moneyAccountNames: names };
  }
  const into = money.find((e) => e.amountMinor > 0) ?? money[0] ?? tx.entries[0]!;
  const isOpening = equity.length > 0 && money.length === 1;
  // A balance fixed to what was counted posts against equity too, but it is no opening balance: it says so.
  const isCorrection = isOpening && equity.some((e) => e.accountSystemKey === 'balance_correction');
  return { type: isCorrection ? 'correction' : isOpening ? 'opening' : 'transfer', amountMinor: Math.abs(into.amountMinor), currency: into.currency, categoryIds: [], moneyAccountNames: names };
}
