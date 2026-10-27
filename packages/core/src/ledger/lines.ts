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

/**
 * Money back on a purchase: the reverse of `expenseLines`. The category is credited, so what it spent nets down,
 * and the account paid with is debited — a card is owed less, a bank account holds more. `amountMinor` is the
 * refund as a positive figure.
 */
export function refundLines(p: {
  categoryAccountId: string;
  paymentAccountId: string;
  amountMinor: number;
  currency: string;
  memo?: string | null;
}): PostingLine[] {
  return [
    { accountId: p.paymentAccountId, amountMinor: p.amountMinor, currency: p.currency },
    { accountId: p.categoryAccountId, amountMinor: -p.amountMinor, currency: p.currency, memo: p.memo ?? null },
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

/**
 * A credit card topping up a digital wallet, as the card's statement prints it: one charge of what landed and its fee
 * together. The wallet takes what landed, the card owes the whole charge, and the fee is spending. The card's line
 * names Top-ups (`spendCategoryId`), so its points are read once on the whole charge under Top-ups' code — never
 * under the fee's category, which a card's rules treat as a bank charge that earns nothing — and the fee line is not
 * counted again. One builder for every door that records one: the Top up door, the Transfer and Expense tabs, and a
 * statement check's missing row.
 *
 * `chargedMinor` is the whole charge and `feeMinor` the part of it that is the fee: 0 for none, and always less than
 * the charge, so something lands.
 */
export function cardTopUpLines(p: {
  cardAccountId: string;
  walletAccountId: string;
  chargedMinor: number;
  feeMinor: number;
  currency: string;
  topUpsCategoryId: string;
  /** Where the fee is spent; needed only when there is one. */
  feeCategoryId?: string | null;
}): PostingLine[] {
  if (!Number.isSafeInteger(p.chargedMinor) || p.chargedMinor <= 0) throw new Error('Enter the amount charged');
  if (!Number.isSafeInteger(p.feeMinor) || p.feeMinor < 0) throw new Error('A fee cannot be below zero');
  if (p.feeMinor >= p.chargedMinor) throw new Error('The fee must be less than the amount charged');
  if (!p.walletAccountId) throw new Error('Choose the wallet it went into');
  if (p.walletAccountId === p.cardAccountId) throw new Error('From and To must differ');
  if (p.feeMinor > 0 && !p.feeCategoryId) throw new Error('Choose a category for the fee');
  return [
    { accountId: p.walletAccountId, amountMinor: p.chargedMinor - p.feeMinor, currency: p.currency },
    { accountId: p.cardAccountId, amountMinor: -p.chargedMinor, currency: p.currency, spendCategoryId: p.topUpsCategoryId },
    ...(p.feeMinor > 0 ? [{ accountId: p.feeCategoryId!, amountMinor: p.feeMinor, currency: p.currency }] : []),
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

/**
 * A same-currency transfer with a fee beside it, as a statement prints it: what left is the transfer and its fee
 * together — the one line, Rp 1.010.000 — what landed is the transfer alone, and the fee is spending. Paid from a
 * card, the card's line names the fee's category (`fromIsCard`), so its points are read once on the whole charge, as
 * the bank reads it, and the fee line is not counted again. One builder for the plain transfer and the transfer for a
 * goal, so the two cannot post two shapes of the same fee. A fee of 0 is the plain `transferLines`.
 */
export function transferWithFeeLines(p: {
  fromAccountId: string;
  toAccountId: string;
  amountMinor: number;
  feeMinor: number;
  currency: string;
  /** Where the fee is spent; needed only when there is one. */
  feeCategoryId?: string | null;
  fromIsCard?: boolean;
}): PostingLine[] {
  if (!Number.isSafeInteger(p.feeMinor) || p.feeMinor < 0) throw new Error('A fee cannot be below zero');
  if (p.feeMinor === 0) return transferLines(p);
  if (!p.feeCategoryId) throw new Error('Choose a category for the fee');
  return [
    { accountId: p.toAccountId, amountMinor: p.amountMinor, currency: p.currency },
    { accountId: p.fromAccountId, amountMinor: -(p.amountMinor + p.feeMinor), currency: p.currency, ...(p.fromIsCard ? { spendCategoryId: p.feeCategoryId } : {}) },
    { accountId: p.feeCategoryId, amountMinor: p.feeMinor, currency: p.currency },
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

/**
 * A cross-currency movement with a fee beside it — a cash withdrawal into a foreign pocket, an ATM or bank fee on the
 * way. The fee is in the From account's currency: what left is the amount and the fee together (the one line, as a
 * statement prints it), the exchange account takes the amount alone, and the To account receives the converted
 * amount only — the fee is never converted. Each currency balances by itself. A fee of 0 is the plain `exchangeLines`.
 */
export function exchangeWithFeeLines(p: {
  fromAccountId: string;
  fromAmountMinor: number;
  fromCurrency: string;
  toAccountId: string;
  toAmountMinor: number;
  toCurrency: string;
  exchangeAccountId: string;
  feeMinor: number;
  /** Where the fee is spent; needed only when there is one. */
  feeCategoryId?: string | null;
  fromIsCard?: boolean;
}): PostingLine[] {
  if (!Number.isSafeInteger(p.feeMinor) || p.feeMinor < 0) throw new Error('A fee cannot be below zero');
  if (p.feeMinor === 0) return exchangeLines(p);
  if (!p.feeCategoryId) throw new Error('Choose a category for the fee');
  return [
    { accountId: p.fromAccountId, amountMinor: -(p.fromAmountMinor + p.feeMinor), currency: p.fromCurrency, ...(p.fromIsCard ? { spendCategoryId: p.feeCategoryId } : {}) },
    { accountId: p.exchangeAccountId, amountMinor: p.fromAmountMinor, currency: p.fromCurrency },
    { accountId: p.toAccountId, amountMinor: p.toAmountMinor, currency: p.toCurrency },
    { accountId: p.exchangeAccountId, amountMinor: -p.toAmountMinor, currency: p.toCurrency },
    { accountId: p.feeCategoryId, amountMinor: p.feeMinor, currency: p.fromCurrency },
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
