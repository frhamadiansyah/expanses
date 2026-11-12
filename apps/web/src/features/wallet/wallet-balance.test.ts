import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { spendingBook } from '../accounts/pockets';
import { type BillMonthInput, billsToPay, filteredCards, moneyCardMinor, toggleFilter, walletBox, type WalletBoxInput } from './wallet-balance';
import { walletCredit, walletMoney } from './wallet-model';

const account = (id: string, subtype: string, extra: Partial<AccountRow> = {}) =>
  ({ id, name: id, parentId: null, kind: 'asset', subtype, currency: 'IDR', archivedAt: null, sortOrder: 0, forSpending: 1, ...extra }) as AccountRow;
const card = (id: string, extra: Partial<AccountRow> = {}) => account(id, 'credit_card', { kind: 'liability', ...extra });

const bill = (id: string, extra: Partial<BillMonthInput> = {}): BillMonthInput => ({
  id,
  name: id,
  categoryAccountId: `cat-${id}`,
  month: '2026-11',
  state: 'upcoming',
  payBy: '2026-11-25',
  amountMinor: 100_000,
  estimateMinor: 100_000,
  currency: 'IDR',
  ...extra,
});

describe('the bills still to pay this month', () => {
  it('counts this month’s unpaid occurrences — upcoming, open, due soon and late — soonest first', () => {
    const rows = [
      bill('internet', { payBy: '2026-11-28', state: 'open' }),
      bill('electricity', { payBy: '2026-11-25', state: 'dueSoon' }),
      bill('water', { payBy: '2026-11-05', state: 'overdue' }),
      bill('gym', { payBy: '2026-11-30', state: 'upcoming' }),
    ];
    expect(billsToPay(rows, '2026-11').map((b) => b.id)).toEqual(['water', 'electricity', 'internet', 'gym']);
  });

  it('leaves out a bill paid, skipped or paused this month, and an earlier month still late', () => {
    const rows = [
      bill('paid', { state: 'paid' }),
      bill('skipped', { state: 'skipped' }),
      bill('paused', { state: 'paused' }),
      bill('october', { month: '2026-10', payBy: '2026-10-25', state: 'overdue' }),
      bill('kept'),
    ];
    expect(billsToPay(rows, '2026-11').map((b) => b.id)).toEqual(['kept']);
  });

  it('counts a varying bill at its estimate, marked about, and leaves out one with nothing to go by', () => {
    const rows = [bill('phone', { amountMinor: null, estimateMinor: 500_000 }), bill('new', { amountMinor: null, estimateMinor: null })];
    expect(billsToPay(rows, '2026-11')).toEqual([expect.objectContaining({ id: 'phone', minor: 500_000, about: true })]);
  });

  it('counts only what a sinking fund has not already set aside, and leaves out a bill its fund covers', () => {
    const rows = [bill('insurance', { amountMinor: 1_200_000 }), bill('tax', { amountMinor: 800_000 })];
    const funds = [
      { billId: 'insurance', minor: 900_000, currency: 'IDR' },
      { billId: 'tax', minor: 800_000, currency: 'IDR' },
    ];
    expect(billsToPay(rows, '2026-11', funds)).toEqual([expect.objectContaining({ id: 'insurance', minor: 300_000, setAsideMinor: 900_000 })]);
  });

  it('nets a fund only in its bill’s own currency', () => {
    expect(billsToPay([bill('visa', { currency: 'SGD', amountMinor: 10_000 })], '2026-11', [{ billId: 'visa', minor: 4_000, currency: 'IDR' }])[0]!.minor).toBe(10_000);
  });
});

/*
 * The mockup's table (docs/mockups/2026-11-12-wallet-after-bills.html): Payroll and an e-wallet, two credit cards,
 * three bills. Paying a bill by card, a bill from the bank, then the card from the bank, the Balance never moves.
 */
describe('the Balance through a month of paying', () => {
  const accounts = [account('payroll', 'bank'), account('ewallet', 'ewallet'), card('card-1234'), card('card-5678')];
  const book = spendingBook(accounts);
  const credit = walletCredit(accounts);
  const bills = (paid: readonly string[]) => [
    bill('Electricity', { payBy: '2026-11-25', amountMinor: 450_000, state: paid.includes('Electricity') ? 'paid' : 'upcoming' }),
    bill('Internet', { payBy: '2026-11-28', amountMinor: 200_000, state: paid.includes('Internet') ? 'paid' : 'upcoming' }),
    bill('Phone plan', { payBy: '2026-11-30', amountMinor: null, estimateMinor: 500_000 }),
  ];
  const box = (balances: Record<string, number>, paid: readonly string[] = []) =>
    walletBox({ book, balances, credit, baseCurrency: 'IDR', rates: {}, setAsides: [], bills: bills(paid), month: '2026-11' });
  // A credit card's balance is a liability's: owed is below nought in the ledger.
  const steps: { on: string; balances: Record<string, number>; paid: string[]; spending: number; cards: number; billsLeft: number }[] = [
    { on: '1 Nov · start', balances: { payroll: 5_900_000, ewallet: 900_000, 'card-1234': -1_650_000, 'card-5678': -500_000 }, paid: [], spending: 6_800_000, cards: 2_150_000, billsLeft: 1_150_000 },
    { on: '20 Nov · Electricity paid with card 1234', balances: { payroll: 5_900_000, ewallet: 900_000, 'card-1234': -2_100_000, 'card-5678': -500_000 }, paid: ['Electricity'], spending: 6_800_000, cards: 2_600_000, billsLeft: 700_000 },
    { on: '22 Nov · Internet paid from Payroll', balances: { payroll: 5_700_000, ewallet: 900_000, 'card-1234': -2_100_000, 'card-5678': -500_000 }, paid: ['Electricity', 'Internet'], spending: 6_600_000, cards: 2_600_000, billsLeft: 500_000 },
    { on: '25 Nov · card 1234 paid from Payroll', balances: { payroll: 3_600_000, ewallet: 900_000, 'card-1234': 0, 'card-5678': -500_000 }, paid: ['Electricity', 'Internet'], spending: 4_500_000, cards: 500_000, billsLeft: 500_000 },
  ];
  for (const step of steps) {
    it(`stays at 3.500.000 — ${step.on}`, () => {
      const result = box(step.balances, step.paid);
      expect(result).toMatchObject({ spendingMinor: step.spending, cardsMinor: step.cards, billsMinor: step.billsLeft, balanceMinor: 3_500_000, missing: [], estimated: false });
    });
  }

  it('lists the bills the row adds up, in the sheet’s order', () => {
    expect(box(steps[0]!.balances).bills.map((b) => [b.name, b.minor, b.about])).toEqual([
      ['Electricity', 450_000, false],
      ['Internet', 200_000, false],
      ['Phone plan', 500_000, true],
    ]);
  });

  it('has no bills row to show once every bill is dealt with', () => {
    const result = walletBox({ book, balances: steps[0]!.balances, credit, baseCurrency: 'IDR', rates: {}, setAsides: [], bills: [], month: '2026-11' });
    expect(result.bills).toEqual([]);
    expect(result.billsMinor).toBe(0);
    expect(result.balanceMinor).toBe(4_650_000);
  });
});

describe('the box with set-asides and other currencies', () => {
  const accounts = [account('payroll', 'bank'), card('card')];
  const base: WalletBoxInput = {
    book: spendingBook(accounts),
    balances: { payroll: 10_000_000, card: -1_000_000 },
    credit: walletCredit(accounts),
    baseCurrency: 'IDR',
    rates: {},
    setAsides: [],
    bills: [],
    month: '2026-11',
  };

  it('takes a funded yearly bill off once: its saving with the set-asides, only the rest as a bill', () => {
    const result = walletBox({
      ...base,
      setAsides: [{ accountId: 'payroll', setAsideMinor: 2_000_000, currency: 'IDR', funds: [{ billId: 'insurance', promisedMinor: 1_500_000 }] }],
      bills: [bill('insurance', { amountMinor: 1_800_000 })],
    });
    expect(result).toMatchObject({ spendingMinor: 8_000_000, cardsMinor: 1_000_000, billsMinor: 300_000, balanceMinor: 6_700_000 });
  });

  it('does not net a fund kept on money the box does not count', () => {
    const result = walletBox({
      ...base,
      setAsides: [{ accountId: 'elsewhere', setAsideMinor: 1_500_000, currency: 'IDR', funds: [{ billId: 'insurance', promisedMinor: 1_500_000 }] }],
      bills: [bill('insurance', { amountMinor: 1_800_000 })],
    });
    expect(result).toMatchObject({ spendingMinor: 10_000_000, billsMinor: 1_800_000 });
  });

  it('converts a bill in another currency, and names a missing rate rather than adding it raw', () => {
    const sgd = [bill('visa', { currency: 'SGD', amountMinor: 10_000 })];
    expect(walletBox({ ...base, bills: sgd, rates: { SGD: 12_000 } })).toMatchObject({ billsMinor: 1_200_000, balanceMinor: 7_800_000, estimated: true });
    expect(walletBox({ ...base, bills: sgd })).toMatchObject({ spendingMinor: null, cardsMinor: null, billsMinor: null, balanceMinor: null, missing: ['SGD'] });
  });
});

describe('a row tapped filters the grid', () => {
  const accounts = [
    account('payroll', 'bank'),
    account('wise', 'bank'),
    account('wise-usd', 'bank', { parentId: 'wise', currency: 'USD' }),
    account('wise-idr', 'bank', { parentId: 'wise' }),
    account('ewallet', 'ewallet'),
    account('rainy', 'savings', { forSpending: 0 }),
    card('card-1234'),
    card('card-0', { sortOrder: 0 }),
  ];
  const book = spendingBook(accounts);
  const money = walletMoney(accounts);
  const credit = walletCredit(accounts);
  const cards = [...money, ...credit].map((a) => ({ key: a.id }));
  const balances = { payroll: 5_900_000, 'wise-usd': 10_000, 'wise-idr': 100_000, ewallet: 900_000, rainy: 4_000_000, 'card-1234': -1_650_000 };
  const rates = { USD: 16_000 };
  const box = walletBox({ book, balances, credit, baseCurrency: 'IDR', rates, setAsides: [], bills: [], month: '2026-11' });

  it('toggles: a row once filters, the same row again clears, the other row switches', () => {
    expect(toggleFilter(null, 'spending')).toBe('spending');
    expect(toggleFilter('spending', 'spending')).toBeNull();
    expect(toggleFilter('spending', 'cards')).toBe('cards');
  });

  it('Spending money keeps the money cards, and they add up to its figure', () => {
    const shown = filteredCards(cards, 'spending', money, credit);
    expect(shown.map((c) => c.key)).toEqual(['payroll', 'wise', 'ewallet']);
    const total = shown.reduce((sum, c) => sum + moneyCardMinor(accounts.find((a) => a.id === c.key)!, book, balances, 'IDR', rates)!, 0);
    expect(total).toBe(box.spendingMinor);
  });

  it('Owed on cards keeps every credit card, one owing nothing too, and they add up to its figure', () => {
    const shown = filteredCards(cards, 'cards', money, credit);
    expect(shown.map((c) => c.key)).toEqual(['card-1234', 'card-0']);
    const owed = shown.reduce((sum, c) => sum + Math.max(0, -(balances[c.key as keyof typeof balances] ?? 0)), 0);
    expect(owed).toBe(box.cardsMinor);
  });

  it('no filter keeps every card, in the grid’s order', () => {
    expect(filteredCards(cards, null, money, credit)).toEqual(cards);
  });
});
