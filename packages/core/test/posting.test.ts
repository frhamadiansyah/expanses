import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  exchangeLines,
  expenseLines,
  incomeLines,
  openingBalanceLines,
  planPosting,
  PostingError,
  splitExpenseLines,
  transferLines,
} from '../src/index';

const accounts: Record<string, string | null> = {
  groceries: null,
  household: null,
  salary: null,
  equity: null,
  fx: null,
  checking: 'IDR',
  visa: 'IDR',
  thbCash: 'THB',
};

const plan = (lines: Parameters<typeof planPosting>[0]['lines'], ratesToBase: Record<string, number> = {}) =>
  planPosting({ baseCurrency: 'IDR', lines, ratesToBase, accountCurrencies: accounts });

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof PostingError ? e.code : `other:${String(e)}`;
  }
  return undefined;
}

describe('planPosting', () => {
  it('posts a card purchase as expense debit and liability credit', () => {
    const entries = plan(
      expenseLines({ categoryAccountId: 'groceries', paymentAccountId: 'visa', amountMinor: 500000, currency: 'IDR' }),
    );
    expect(entries.map((e) => [e.accountId, e.amountMinor, e.amountBaseMinor, e.fxRateToBase])).toEqual([
      ['groceries', 500000, 500000, 1],
      ['visa', -500000, -500000, 1],
    ]);
  });

  it('posts a statement payment as a transfer touching no expense account', () => {
    const entries = plan(transferLines({ fromAccountId: 'checking', toAccountId: 'visa', amountMinor: 8000000, currency: 'IDR' }));
    expect(entries.map((e) => [e.accountId, e.amountMinor])).toEqual([
      ['visa', 8000000],
      ['checking', -8000000],
    ]);
  });

  it('posts splits against one payment line', () => {
    const entries = plan(
      splitExpenseLines({
        paymentAccountId: 'visa',
        currency: 'IDR',
        splits: [
          { categoryAccountId: 'groceries', amountMinor: 350000 },
          { categoryAccountId: 'household', amountMinor: 150000 },
        ],
      }),
    );
    expect(entries.at(-1)).toMatchObject({ accountId: 'visa', amountMinor: -500000 });
  });

  it('posts income and opening balances', () => {
    expect(plan(incomeLines({ incomeAccountId: 'salary', depositAccountId: 'checking', amountMinor: 10, currency: 'IDR' }))[0])
      .toMatchObject({ accountId: 'checking', amountMinor: 10 });
    expect(
      plan(openingBalanceLines({ accountId: 'visa', kind: 'liability', balanceMinor: 700, currency: 'IDR', equityAccountId: 'equity' }))[0],
    ).toMatchObject({ accountId: 'visa', amountMinor: -700 });
  });

  it('converts foreign lines to base and balances each currency group in base', () => {
    const entries = plan(
      splitExpenseLines({
        paymentAccountId: 'thbCash',
        currency: 'THB',
        splits: [
          { categoryAccountId: 'groceries', amountMinor: 3333 },
          { categoryAccountId: 'household', amountMinor: 3333 },
          { categoryAccountId: 'groceries', amountMinor: 3334 },
        ],
      }),
      { THB: 536.49 },
    );
    expect(entries.reduce((s, e) => s + e.amountBaseMinor, 0)).toBe(0);
    expect(entries[0]!.fxRateToBase).toBe(536.49);
  });

  it('posts a currency exchange balanced per currency', () => {
    const entries = plan(
      exchangeLines({
        fromAccountId: 'checking',
        fromAmountMinor: 1000000,
        fromCurrency: 'IDR',
        toAccountId: 'thbCash',
        toAmountMinor: 186000,
        toCurrency: 'THB',
        exchangeAccountId: 'fx',
      }),
      { THB: 536.49 },
    );
    expect(entries).toHaveLength(4);
  });

  it('rejects invalid postings with specific codes', () => {
    expect(codeOf(() => plan([{ accountId: 'visa', amountMinor: 1, currency: 'IDR' }]))).toBe('TOO_FEW_LINES');
    expect(codeOf(() => plan(transferLines({ fromAccountId: 'checking', toAccountId: 'visa', amountMinor: 0, currency: 'IDR' })))).toBe('ZERO_AMOUNT');
    expect(codeOf(() => plan(transferLines({ fromAccountId: 'checking', toAccountId: 'visa', amountMinor: 1.5, currency: 'IDR' })))).toBe('NOT_INTEGER');
    expect(codeOf(() => plan(transferLines({ fromAccountId: 'nope', toAccountId: 'visa', amountMinor: 1, currency: 'IDR' })))).toBe('UNKNOWN_ACCOUNT');
    expect(codeOf(() => plan(expenseLines({ categoryAccountId: 'groceries', paymentAccountId: 'visa', amountMinor: 1, currency: 'THB' }), { THB: 1 }))).toBe('CURRENCY_MISMATCH');
    expect(
      codeOf(() =>
        plan([
          { accountId: 'groceries', amountMinor: 10, currency: 'IDR' },
          { accountId: 'visa', amountMinor: -9, currency: 'IDR' },
        ]),
      ),
    ).toBe('UNBALANCED');
    expect(codeOf(() => plan(expenseLines({ categoryAccountId: 'groceries', paymentAccountId: 'thbCash', amountMinor: 1, currency: 'THB' })))).toBe('MISSING_RATE');
  });

  it('property: any balanced foreign split sums to zero natively and in base', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 50_000_000 }), { minLength: 1, maxLength: 12 }),
        fc.double({ min: 0.0001, max: 50_000, noNaN: true }),
        (amounts, rate) => {
          const entries = plan(
            splitExpenseLines({
              paymentAccountId: 'thbCash',
              currency: 'THB',
              splits: amounts.map((amountMinor, i) => ({ categoryAccountId: i % 2 ? 'groceries' : 'household', amountMinor })),
            }),
            { THB: rate },
          );
          expect(entries.reduce((s, e) => s + e.amountMinor, 0)).toBe(0);
          expect(entries.reduce((s, e) => s + e.amountBaseMinor, 0)).toBe(0);
          for (const e of entries) expect(Number.isSafeInteger(e.amountBaseMinor)).toBe(true);
        },
      ),
    );
  });
});
