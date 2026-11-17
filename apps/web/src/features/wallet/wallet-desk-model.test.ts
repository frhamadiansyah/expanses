import { describe, expect, it } from 'vitest';
import { deskGroupOf, deskGroups, type DeskItem, lineChange, movedOnto, moneySplit, readDeskView, writeDeskView } from './wallet-desk-model';

const money = (key: string, subtype: string, minor: number | null, currency = 'IDR', currencies = [currency]): DeskItem => ({
  key,
  name: key,
  side: 'money',
  subtype,
  currencies,
  minor,
  currency,
});
const card = (key: string, minor: number, currency = 'IDR'): DeskItem => ({
  key,
  name: key,
  side: 'credit',
  subtype: 'credit_card',
  currencies: [currency],
  minor,
  currency,
});

describe('deskGroupOf', () => {
  it('puts a credit card with the cards, whatever its currency', () => {
    expect(deskGroupOf(card('visa', 100), 'IDR')).toBe('credit');
    expect(deskGroupOf(card('usd card', 100, 'USD'), 'IDR')).toBe('credit');
  });

  it('puts current and saving accounts with the banks, the rest of the money with cash and e-wallets', () => {
    expect(deskGroupOf(money('bca', 'bank', 1), 'IDR')).toBe('bank');
    expect(deskGroupOf(money('jenius', 'savings', 1), 'IDR')).toBe('bank');
    for (const subtype of ['cash', 'ewallet', 'emoney', 'other_cash']) expect(deskGroupOf(money('m', subtype, 1), 'IDR')).toBe('cash');
  });

  it('puts money holding any other currency — its own or a pocket’s — in foreign currency', () => {
    expect(deskGroupOf(money('baht', 'cash', 1, 'THB'), 'IDR')).toBe('foreign');
    expect(deskGroupOf(money('valas', 'bank', 1, 'IDR', ['IDR', 'USD']), 'IDR')).toBe('foreign');
    // An account with pockets all in the base currency is a bank account like any other.
    expect(deskGroupOf(money('two idr', 'bank', 1, 'IDR', ['IDR', 'IDR']), 'IDR')).toBe('bank');
  });
});

describe('deskGroups', () => {
  const rates = { THB: 460, USD: 16_000 };
  const items = [
    card('visa', 7_200_000),
    money('bca', 'bank', 306_000_000),
    money('cash', 'cash', 193_000),
    money('baht', 'cash', 8_860_00, 'THB'),
    money('jenius', 'savings', 92_500_000),
    money('gopay', 'ewallet', 669_000),
    card('cimb', 3_900_000),
  ];

  it('groups in the page’s order, each card in Wallet’s order within its group, empty groups left out', () => {
    const groups = deskGroups(items, 'IDR', rates);
    expect(groups.map((group) => [group.key, group.title, group.keys])).toEqual([
      ['bank', 'Bank accounts', ['bca', 'jenius']],
      ['cash', 'Cash & e-wallets', ['cash', 'gopay']],
      ['credit', 'Credit cards', ['visa', 'cimb']],
      ['foreign', 'Foreign currency', ['baht']],
    ]);
    expect(deskGroups([money('bca', 'bank', 1)], 'IDR', rates).map((group) => group.key)).toEqual(['bank']);
  });

  it('totals each group in the base currency: the money’s balances, what the cards owe as a negative', () => {
    const groups = deskGroups(items, 'IDR', rates);
    const total = (key: string) => groups.find((group) => group.key === key)!.totalMinor;
    expect(total('bank')).toBe(398_500_000);
    expect(total('cash')).toBe(862_000);
    expect(total('credit')).toBe(-11_100_000);
    // 8.860 baht at 460 rupiah each.
    expect(total('foreign')).toBe(4_075_600);
    expect(groups.find((group) => group.key === 'foreign')!.approx).toBe(true);
    expect(groups.find((group) => group.key === 'bank')!.approx).toBe(false);
  });

  it('counts a card only for what it owes, as Outstanding on cards does: a card in credit adds nothing', () => {
    const [credit] = deskGroups([card('visa', 500_000), card('in credit', -50_000)], 'IDR', rates);
    expect(credit!.totalMinor).toBe(-500_000);
  });

  it('has no total while a figure or a rate is missing', () => {
    expect(deskGroups([money('valas', 'bank', null, 'IDR', ['IDR', 'EUR'])], 'IDR', rates)[0]!.totalMinor).toBeNull();
    expect(deskGroups([money('euro', 'cash', 100, 'EUR')], 'IDR', rates)[0]!.totalMinor).toBeNull();
  });
});

describe('moneySplit', () => {
  const at = (key: string, baseMinor: number | null) => ({
    key,
    name: key,
    baseMinor,
  });

  it('names the two largest and folds the rest into Others, the percents adding up to 100', () => {
    const parts = moneySplit([at('cash', 193_000), at('bca', 306_000_000), at('wise', 39_100_000), at('jenius', 92_500_000), at('gopay', 669_000)]);
    expect(parts.map((part) => [part.key, part.name, part.count])).toEqual([
      ['bca', 'bca', 1],
      ['jenius', 'jenius', 1],
      ['others', 'Others', 3],
    ]);
    expect(parts.map((part) => part.percent)).toEqual([70, 21, 9]);
    expect(parts.reduce((sum, part) => sum + part.percent, 0)).toBe(100);
    expect(parts[2]!.minor).toBe(39_100_000 + 669_000 + 193_000);
  });

  it('names the one card left rather than calling it Others', () => {
    const parts = moneySplit([at('a', 50), at('b', 30), at('c', 20)]);
    expect(parts.map((part) => [part.name, part.percent])).toEqual([
      ['a', 50],
      ['b', 30],
      ['c', 20],
    ]);
  });

  it('gives the leftover points to the largest fractions, so three thirds read 34, 33, 33', () => {
    expect(moneySplit([at('a', 1), at('b', 1), at('c', 1)]).map((part) => part.percent)).toEqual([34, 33, 33]);
  });

  it('leaves out money holding nothing, overdrawn, or without a figure; nothing held is no bar', () => {
    expect(moneySplit([at('a', 100), at('b', 0), at('c', -40), at('d', null)]).map((part) => [part.key, part.percent])).toEqual([['a', 100]]);
    expect(moneySplit([at('a', 0), at('b', -5)])).toEqual([]);
  });
});

describe('lineChange', () => {
  it('is today’s figure less the line’s first day’s', () => {
    expect(
      lineChange([
        { on: '2026-10-18', minor: 1000 },
        { on: '2026-10-19', minor: 700 },
        { on: '2026-11-17', minor: 4100 },
      ]),
    ).toBe(3100);
    expect(lineChange([{ on: '2026-11-17', minor: 5 }])).toBeNull();
    expect(lineChange(null)).toBeNull();
  });
});

describe('movedOnto', () => {
  const order = ['a', 'b', 'c', 'd'];
  it('takes the place of the card it is dropped on, either way', () => {
    expect(movedOnto(order, 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
    expect(movedOnto(order, 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
  });
  it('moves nothing onto itself or an unknown card', () => {
    expect(movedOnto(order, 'b', 'b')).toBeNull();
    expect(movedOnto(order, 'x', 'b')).toBeNull();
  });
});

describe('the desk view', () => {
  it('is Cards unless List was chosen, and remembers List only', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    expect(readDeskView(storage)).toBe('cards');
    writeDeskView('list', storage);
    expect(readDeskView(storage)).toBe('list');
    writeDeskView('cards', storage);
    expect(store.size).toBe(0);
    expect(
      readDeskView({
        getItem: () => {
          throw new Error('private');
        },
      }),
    ).toBe('cards');
  });
});
