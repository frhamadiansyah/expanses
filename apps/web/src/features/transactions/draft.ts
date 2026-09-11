import {
  exchangeLines,
  expenseLines,
  incomeLines,
  isoDate,
  minorToMajorString,
  parseMajor,
  type PostingLine,
  splitExpenseLines,
  transferLines,
} from '@expanses/core';
import type { AccountRow, TransactionView } from '@expanses/db';
import { classify } from './classify';

export type Mode = 'expense' | 'income' | 'transfer';

export interface SplitRow {
  categoryId: string;
  amount: string;
}

/** Form state for entering or editing a transaction. Amounts are the user's typed strings. */
export interface Draft {
  mode: Mode;
  occurredOn: string;
  description: string;
  /** Paid with / received into / transfer from. */
  moneyId: string;
  toId: string;
  categoryId: string;
  amount: string;
  toAmount: string;
  splits: SplitRow[];
  /** Currency the merchant charged before a card converted it; '' when unused. */
  originalCurrency: string;
  originalAmount: string;
  /** Typed merchant category code; '' when unused. */
  mcc: string;
  /** When set, the MCC is remembered for purchases containing this text instead of typed on the purchase. */
  rememberPattern: string;
}

export function emptyDraft(today: string = isoDate()): Draft {
  return { mode: 'expense', occurredOn: today, description: '', moneyId: '', toId: '', categoryId: '', amount: '', toAmount: '', splits: [], originalCurrency: '', originalAmount: '', mcc: '', rememberPattern: '' };
}

/** Opening balances post against system equity and have no form that can represent them. */
export function isEditable(tx: TransactionView): boolean {
  return tx.status === 'posted' && classify(tx).type !== 'opening';
}

const originalFields = (tx: TransactionView) =>
  tx.originalCurrency && tx.originalAmountMinor !== null
    ? { originalCurrency: tx.originalCurrency, originalAmount: minorToMajorString(tx.originalAmountMinor, tx.originalCurrency) }
    : { originalCurrency: '', originalAmount: '' };

export function draftFromTransaction(tx: TransactionView): Draft {
  const c = classify(tx);
  const money = tx.entries.filter((e) => e.accountKind === 'asset' || e.accountKind === 'liability');
  const base = { ...emptyDraft(tx.occurredOn), description: tx.description, ...originalFields(tx), mcc: tx.mcc ?? '' };
  if (c.type === 'expense') {
    const expenses = tx.entries.filter((e) => e.accountKind === 'expense');
    const payment = money[0]!;
    if (expenses.length > 1) {
      return {
        ...base,
        moneyId: payment.accountId,
        splits: expenses.map((e) => ({ categoryId: e.accountId, amount: minorToMajorString(e.amountMinor, e.currency) })),
      };
    }
    return { ...base, moneyId: payment.accountId, categoryId: expenses[0]!.accountId, amount: minorToMajorString(expenses[0]!.amountMinor, payment.currency) };
  }
  if (c.type === 'income') {
    const income = tx.entries.find((e) => e.accountKind === 'income')!;
    return { ...base, mode: 'income', moneyId: money[0]?.accountId ?? '', categoryId: income.accountId, amount: minorToMajorString(-income.amountMinor, income.currency) };
  }
  const from = money.find((e) => e.amountMinor < 0);
  const to = money.find((e) => e.amountMinor > 0);
  return {
    ...base,
    mode: 'transfer',
    moneyId: from?.accountId ?? '',
    toId: to?.accountId ?? '',
    amount: from ? minorToMajorString(-from.amountMinor, from.currency) : '',
    toAmount: to && from && to.currency !== from.currency ? minorToMajorString(to.amountMinor, to.currency) : '',
  };
}

function positive(value: string, currency: string, label: string): number {
  const minor = parseMajor(value, currency);
  if (minor <= 0) throw new Error(`${label} must be greater than zero`);
  return minor;
}

/** Validates the draft and builds balanced posting lines. Throws a user-readable Error on invalid input. */
export function draftToLines(draft: Draft, accounts: AccountRow[]): PostingLine[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const money = byId.get(draft.moneyId);
  if (!money?.currency) throw new Error(draft.mode === 'transfer' ? 'Choose the From account' : 'Choose an account');
  const currency = money.currency;

  if (draft.mode === 'expense') {
    if (draft.splits.length > 0) {
      const splits = draft.splits.map((row, i) => {
        if (!row.categoryId) throw new Error(`Choose a category for split ${i + 1}`);
        return { categoryAccountId: row.categoryId, amountMinor: positive(row.amount, currency, `Split ${i + 1} amount`) };
      });
      return splitExpenseLines({ paymentAccountId: money.id, currency, splits });
    }
    if (!draft.categoryId) throw new Error('Choose a category');
    return expenseLines({ categoryAccountId: draft.categoryId, paymentAccountId: money.id, amountMinor: positive(draft.amount, currency, 'Amount'), currency });
  }

  if (draft.mode === 'income') {
    if (!draft.categoryId) throw new Error('Choose a category');
    return incomeLines({ incomeAccountId: draft.categoryId, depositAccountId: money.id, amountMinor: positive(draft.amount, currency, 'Amount'), currency });
  }

  const to = byId.get(draft.toId);
  if (!to?.currency) throw new Error('Choose the To account');
  if (to.id === money.id) throw new Error('From and To must differ');
  const amountMinor = positive(draft.amount, currency, 'Amount');
  if (to.currency === currency) return transferLines({ fromAccountId: money.id, toAccountId: to.id, amountMinor, currency });
  const exchange = accounts.find((a) => a.systemKey === 'currency_exchange');
  if (!exchange) throw new Error('Currency exchange account missing');
  return exchangeLines({
    fromAccountId: money.id,
    fromAmountMinor: amountMinor,
    fromCurrency: currency,
    toAccountId: to.id,
    toAmountMinor: positive(draft.toAmount, to.currency, 'Received amount'),
    toCurrency: to.currency,
    exchangeAccountId: exchange.id,
  });
}

const isCardExpense = (draft: Draft, accounts: AccountRow[]) =>
  draft.mode === 'expense' && accounts.find((a) => a.id === draft.moneyId)?.subtype === 'credit_card';

function typedMcc(draft: Draft): string | null {
  const mcc = draft.mcc.trim();
  if (!mcc) return null;
  if (!/^\d{4}$/.test(mcc)) throw new Error('An MCC is four digits, like 5814');
  // A remembered merchant supplies the MCC, so the purchase itself stays untyped.
  return draft.rememberPattern.trim() ? null : mcc;
}

/**
 * Original currency, original amount, and typed MCC of a card expense. Anything else carries none, so editing a
 * purchase onto a bank account clears them; a currency equal to the card's is not an original currency.
 */
export function draftToExtras(draft: Draft, accounts: AccountRow[]): { originalCurrency: string | null; originalAmountMinor: number | null; mcc: string | null } {
  if (!isCardExpense(draft, accounts)) return { originalCurrency: null, originalAmountMinor: null, mcc: null };
  const payment = accounts.find((a) => a.id === draft.moneyId)!;
  const mcc = typedMcc(draft);
  const currency = draft.originalCurrency.trim();
  const amount = draft.originalAmount.trim();
  if ((!currency && !amount) || currency === payment.currency) return { originalCurrency: null, originalAmountMinor: null, mcc };
  if (!currency) throw new Error('Choose the currency the merchant charged');
  if (!amount) throw new Error(`Enter the amount charged in ${currency}`);
  return { originalCurrency: currency, originalAmountMinor: positive(amount, currency, 'Original amount'), mcc };
}

/** The merchant memory entry to save with a card expense, when the user chose to remember its MCC. */
export function draftToMemory(draft: Draft, accounts: AccountRow[]): { pattern: string; mcc: string } | null {
  if (!isCardExpense(draft, accounts)) return null;
  const pattern = draft.rememberPattern.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!pattern) return null;
  const mcc = draft.mcc.trim();
  if (!mcc) throw new Error('Choose the MCC to remember for this merchant');
  if (!/^\d{4}$/.test(mcc)) throw new Error('An MCC is four digits, like 5814');
  return { pattern, mcc };
}
