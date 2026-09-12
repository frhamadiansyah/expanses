import { describe, expect, it } from 'vitest';
import {
  borrowPostings,
  type DebtAccounts,
  DebtError,
  debtDescription,
  forgivePostings,
  lendPostings,
  type PostingLine,
  repayBorrowedPostings,
  repaymentPostings,
  type SplitShare,
  splitBillPostings,
} from '../src/index';

const accounts: DebtAccounts = {
  debtAccountId: 'andi',
  moneyAccountId: 'bca',
  otherIncomeAccountId: 'other-income',
  interestAccountId: 'interest',
  forgivenessAccountId: 'gifts',
};

const sum = (lines: PostingLine[]): number => lines.reduce((total, line) => total + line.amountMinor, 0);
const on = (lines: PostingLine[], accountId: string): number =>
  lines.filter((line) => line.accountId === accountId).reduce((total, line) => total + line.amountMinor, 0);

describe('lending money', () => {
  it('moves money from the bank to the person', () => {
    const lines = lendPostings({ amountMinor: 10_000_000, currency: 'IDR' }, accounts);

    expect(on(lines, 'andi')).toBe(10_000_000);
    expect(on(lines, 'bca')).toBe(-10_000_000);
  });

  it('refuses an amount of zero or less', () => {
    expect(() => lendPostings({ amountMinor: 0, currency: 'IDR' }, accounts)).toThrow(DebtError);
    expect(() => lendPostings({ amountMinor: -1, currency: 'IDR' }, accounts)).toThrow(/greater than zero/);
  });
});

describe('a repayment received', () => {
  it('lowers what the person owes and raises the bank', () => {
    const lines = repaymentPostings({ amountMinor: 3_000_000, interestMinor: 0, currency: 'IDR', balanceMinor: 10_000_000, personName: 'Andi' }, accounts);

    expect(on(lines, 'andi')).toBe(-3_000_000);
    expect(on(lines, 'bca')).toBe(3_000_000);
  });

  it('puts interest under Other Income, never into principal', () => {
    const lines = repaymentPostings({ amountMinor: 3_000_000, interestMinor: 200_000, currency: 'IDR', balanceMinor: 10_000_000, personName: 'Andi' }, accounts);

    // The principal falls by the principal only; the bank receives both.
    expect(on(lines, 'andi')).toBe(-3_000_000);
    expect(on(lines, 'other-income')).toBe(-200_000);
    expect(on(lines, 'bca')).toBe(3_200_000);
  });

  it('names the person and what they owe when the repayment is too big', () => {
    expect(() =>
      repaymentPostings({ amountMinor: 12_000_000, interestMinor: 0, currency: 'IDR', balanceMinor: 9_000_000, personName: 'Andi' }, accounts),
    ).toThrow(/Andi owes Rp\s?9\.000\.000/);
  });

  it('allows a repayment that clears the balance exactly', () => {
    const lines = repaymentPostings({ amountMinor: 9_000_000, interestMinor: 0, currency: 'IDR', balanceMinor: 9_000_000, personName: 'Andi' }, accounts);

    expect(on(lines, 'andi')).toBe(-9_000_000);
  });
});

describe('borrowing money', () => {
  it('raises the payable and the bank', () => {
    const lines = borrowPostings({ amountMinor: 5_000_000, currency: 'IDR' }, accounts);

    expect(on(lines, 'bca')).toBe(5_000_000);
    expect(on(lines, 'andi')).toBe(-5_000_000);
  });

  it('charges interest to Interest when paying it back, not to principal', () => {
    const lines = repayBorrowedPostings({ amountMinor: 2_000_000, interestMinor: 100_000, currency: 'IDR', balanceMinor: 5_000_000, personName: 'Budi' }, accounts);

    expect(on(lines, 'andi')).toBe(2_000_000);
    expect(on(lines, 'interest')).toBe(100_000);
    expect(on(lines, 'bca')).toBe(-2_100_000);
  });

  it('refuses to repay more than is owed, naming the person', () => {
    expect(() =>
      repayBorrowedPostings({ amountMinor: 6_000_000, interestMinor: 0, currency: 'IDR', balanceMinor: 5_000_000, personName: 'Budi' }, accounts),
    ).toThrow(/Budi is owed Rp\s?5\.000\.000/);
  });
});

describe('forgiving what is left', () => {
  it('empties the balance and books it as a gift', () => {
    const lines = forgivePostings({ balanceMinor: 4_000_000, currency: 'IDR' }, accounts);

    expect(on(lines, 'andi')).toBe(-4_000_000);
    expect(on(lines, 'gifts')).toBe(4_000_000);
  });

  it('refuses to forgive nothing', () => {
    expect(() => forgivePostings({ balanceMinor: 0, currency: 'IDR' }, accounts)).toThrow(DebtError);
  });
});

describe('splitting a bill', () => {
  const shares: SplitShare[] = [
    { debtAccountId: 'andi', amountMinor: 300_000 },
    { debtAccountId: 'budi', amountMinor: 300_000 },
  ];

  it('charges your own share to the category and each friend to their own account', () => {
    const lines = splitBillPostings(
      { totalMinor: 900_000, ownCategoryId: 'dining', ownShareMinor: 300_000, shares, currency: 'IDR' },
      { moneyAccountId: 'card' },
    );

    expect(on(lines, 'dining')).toBe(300_000);
    expect(on(lines, 'andi')).toBe(300_000);
    expect(on(lines, 'budi')).toBe(300_000);
    expect(on(lines, 'card')).toBe(-900_000);
  });

  it('refuses a split that does not add up to the total', () => {
    expect(() =>
      splitBillPostings({ totalMinor: 900_000, ownCategoryId: 'dining', ownShareMinor: 200_000, shares, currency: 'IDR' }, { moneyAccountId: 'card' }),
    ).toThrow(/adds up to Rp\s?800\.000/);
  });

  it('allows a bill where you owe nothing yourself', () => {
    const lines = splitBillPostings(
      { totalMinor: 600_000, ownCategoryId: 'dining', ownShareMinor: 0, shares, currency: 'IDR' },
      { moneyAccountId: 'card' },
    );

    expect(on(lines, 'dining')).toBe(0);
    expect(on(lines, 'card')).toBe(-600_000);
  });
});

describe('every builder', () => {
  it('balances to zero', () => {
    const all: PostingLine[][] = [
      lendPostings({ amountMinor: 10_000_000, currency: 'IDR' }, accounts),
      repaymentPostings({ amountMinor: 3_000_000, interestMinor: 200_000, currency: 'IDR', balanceMinor: 10_000_000, personName: 'Andi' }, accounts),
      borrowPostings({ amountMinor: 5_000_000, currency: 'IDR' }, accounts),
      repayBorrowedPostings({ amountMinor: 2_000_000, interestMinor: 100_000, currency: 'IDR', balanceMinor: 5_000_000, personName: 'Budi' }, accounts),
      forgivePostings({ balanceMinor: 4_000_000, currency: 'IDR' }, accounts),
      splitBillPostings(
        { totalMinor: 900_000, ownCategoryId: 'dining', ownShareMinor: 300_000, shares: [{ debtAccountId: 'andi', amountMinor: 600_000 }], currency: 'IDR' },
        { moneyAccountId: 'card' },
      ),
    ];

    for (const lines of all) expect(sum(lines)).toBe(0);
  });

  it('puts every line in the currency it was given', () => {
    const lines = lendPostings({ amountMinor: 1_000_00, currency: 'USD' }, accounts);

    expect(lines.every((line) => line.currency === 'USD')).toBe(true);
  });
});

describe('debtDescription', () => {
  it('says what happened, in the owner words', () => {
    expect(debtDescription('lend', 'Andi')).toBe('Lent to Andi');
    expect(debtDescription('repayment', 'Andi')).toBe('Repayment from Andi');
    expect(debtDescription('borrow', 'Budi')).toBe('Borrowed from Budi');
    expect(debtDescription('repay', 'Budi')).toBe('Repaid Budi');
    expect(debtDescription('forgive', 'Andi')).toBe('Forgave what Andi owed');
  });
});
