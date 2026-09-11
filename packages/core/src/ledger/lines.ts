import type { PostingLine } from './types';

export function expenseLines(p: {
  categoryAccountId: string;
  paymentAccountId: string;
  amountMinor: number;
  currency: string;
  memo?: string | null;
}): PostingLine[] {
  return [
    { accountId: p.categoryAccountId, amountMinor: p.amountMinor, currency: p.currency, memo: p.memo ?? null },
    { accountId: p.paymentAccountId, amountMinor: -p.amountMinor, currency: p.currency },
  ];
}

export function splitExpenseLines(p: {
  paymentAccountId: string;
  currency: string;
  splits: { categoryAccountId: string; amountMinor: number; memo?: string | null }[];
}): PostingLine[] {
  const total = p.splits.reduce((s, x) => s + x.amountMinor, 0);
  return [
    ...p.splits.map((x) => ({
      accountId: x.categoryAccountId,
      amountMinor: x.amountMinor,
      currency: p.currency,
      memo: x.memo ?? null,
    })),
    { accountId: p.paymentAccountId, amountMinor: -total, currency: p.currency },
  ];
}

export function incomeLines(p: {
  incomeAccountId: string;
  depositAccountId: string;
  amountMinor: number;
  currency: string;
  memo?: string | null;
}): PostingLine[] {
  return [
    { accountId: p.depositAccountId, amountMinor: p.amountMinor, currency: p.currency },
    { accountId: p.incomeAccountId, amountMinor: -p.amountMinor, currency: p.currency, memo: p.memo ?? null },
  ];
}

/** Same-currency movement, including paying a credit card statement from a bank account. */
export function transferLines(p: {
  fromAccountId: string;
  toAccountId: string;
  amountMinor: number;
  currency: string;
}): PostingLine[] {
  return [
    { accountId: p.toAccountId, amountMinor: p.amountMinor, currency: p.currency },
    { accountId: p.fromAccountId, amountMinor: -p.amountMinor, currency: p.currency },
  ];
}

/** Cross-currency movement balanced per currency through the currency-exchange equity account. */
export function exchangeLines(p: {
  fromAccountId: string;
  fromAmountMinor: number;
  fromCurrency: string;
  toAccountId: string;
  toAmountMinor: number;
  toCurrency: string;
  exchangeAccountId: string;
}): PostingLine[] {
  return [
    { accountId: p.fromAccountId, amountMinor: -p.fromAmountMinor, currency: p.fromCurrency },
    { accountId: p.exchangeAccountId, amountMinor: p.fromAmountMinor, currency: p.fromCurrency },
    { accountId: p.toAccountId, amountMinor: p.toAmountMinor, currency: p.toCurrency },
    { accountId: p.exchangeAccountId, amountMinor: -p.toAmountMinor, currency: p.toCurrency },
  ];
}

/** balanceMinor is natural: money held for assets, amount owed for liabilities. */
export function openingBalanceLines(p: {
  accountId: string;
  kind: 'asset' | 'liability';
  balanceMinor: number;
  currency: string;
  equityAccountId: string;
}): PostingLine[] {
  const signed = p.kind === 'asset' ? p.balanceMinor : -p.balanceMinor;
  return [
    { accountId: p.accountId, amountMinor: signed, currency: p.currency },
    { accountId: p.equityAccountId, amountMinor: -signed, currency: p.currency },
  ];
}
