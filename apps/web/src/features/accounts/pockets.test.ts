import { evaluateAmount } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { formToPost } from '../transactions/tx-form';
import { bankRateText, choosePocketCurrency, moneySummary, moveDraft, moveView, nextPocketCurrency, parentTotal, pocketsOf, readPockets, spreadLine, withPockets } from './pockets';

// Ids deliberately out of order: the pockets were made in one millisecond, so only sort_order says which came first.
const accounts = [
  { id: 'v', name: 'Valas', parentId: null, kind: 'asset', subtype: 'savings', currency: 'IDR', archivedAt: null, sortOrder: 0 },
  { id: 'c-usd', name: 'Valas · USD', parentId: 'v', kind: 'asset', subtype: 'savings', currency: 'USD', archivedAt: null, sortOrder: 0 },
  { id: 'a-sgd', name: 'Valas · SGD', parentId: 'v', kind: 'asset', subtype: 'savings', currency: 'SGD', archivedAt: null, sortOrder: 1 },
  { id: 'b-idr', name: 'Valas · IDR', parentId: 'v', kind: 'asset', subtype: 'savings', currency: 'IDR', archivedAt: null, sortOrder: 2 },
  { id: 'd-jpy', name: 'Valas · JPY', parentId: 'v', kind: 'asset', subtype: 'savings', currency: 'JPY', archivedAt: '2026-01-01', sortOrder: 3 },
  { id: 'fx', name: 'Currency exchange', parentId: null, kind: 'equity', subtype: 'equity', currency: null, systemKey: 'currency_exchange', archivedAt: null, sortOrder: 0 },
] as AccountRow[];
const [, usd, sgd, idr] = accounts as [AccountRow, AccountRow, AccountRow, AccountRow];
const rates = { USD: 16_250, SGD: 12_680 };
const typing = (text: string) => [...text].map((_, i) => text.slice(0, i + 1));

describe('the pockets of an account', () => {
  it('are its open children in the order they were added', () => {
    expect(pocketsOf('v', accounts).map((a) => a.currency)).toEqual(['USD', 'SGD', 'IDR']);
  });

  it('add up to the mockup’s total, or to none when a rate is missing', () => {
    const balances = { 'c-usd': 240_000, 'a-sgd': 115_000, 'b-idr': 5_400_000 };
    expect(parentTotal(pocketsOf('v', accounts), balances, 'IDR', rates)).toEqual({ totalMinor: 58_982_000, missing: [] });
    expect(parentTotal(pocketsOf('v', accounts), balances, 'IDR', { USD: 16_250 })).toEqual({ totalMinor: null, missing: ['SGD'] });
  });
});

describe('the pockets form', () => {
  it('reads each opening balance in that pocket’s own currency', () => {
    expect(
      readPockets([
        { currency: 'USD', balance: '2,400.00', rate: '' },
        { currency: 'SGD', balance: '1.150,5', rate: '12.110,5' },
        { currency: 'IDR', balance: '5.400.000', rate: '' },
        { currency: 'JPY', balance: '', rate: '' },
      ]),
    ).toEqual([
      { currency: 'USD', openingBalanceMinor: 240_000, typedRate: '' },
      { currency: 'SGD', openingBalanceMinor: 115_050, typedRate: '12.110,5' },
      { currency: 'IDR', openingBalanceMinor: 5_400_000, typedRate: '' },
      { currency: 'JPY', openingBalanceMinor: 0, typedRate: '' },
    ]);
  });

  it('refuses a figure the pocket’s currency cannot hold, rather than rounding it', () => {
    expect(() => readPockets([{ currency: 'IDR', balance: '5400000,50', rate: '' }])).toThrow();
  });

  it('swaps two pockets when one is given a currency the other holds, each balance staying with its currency', () => {
    const rows = [
      { currency: 'IDR', balance: '5.400.000', rate: '' },
      { currency: 'USD', balance: '2400.00', rate: '16250' },
      { currency: 'SGD', balance: '', rate: '' },
    ];
    expect(choosePocketCurrency(rows, 0, 'USD')).toEqual([rows[1], rows[0], rows[2]]);
    // A currency no other pocket holds is taken as it is; the typed text is kept and re-read in it.
    expect(choosePocketCurrency(rows, 2, 'JPY')).toEqual([rows[0], rows[1], { currency: 'JPY', balance: '', rate: '' }]);
  });

  it('offers the first currency not yet used', () => {
    expect(nextPocketCurrency([{ currency: 'IDR', balance: '', rate: '' }])).toBe('USD');
    expect(nextPocketCurrency([{ currency: 'IDR', balance: '', rate: '' }, { currency: 'USD', balance: '', rate: '' }])).toBe('SGD');
  });
});

describe('moving between pockets', () => {
  const start = moveDraft('book', usd, sgd, '2026-09-21');

  it('reads Leaves in the From pocket’s currency and Arrives in the To pocket’s', () => {
    const view = moveView({ ...start, amount: '500', toAmount: '638' }, accounts, 'IDR', rates);
    expect([view.leaves.currency, view.arrives!.currency]).toEqual(['USD', 'SGD']);
    expect(view.bankRate).toBeCloseTo(1.276, 10);
    expect(view.cost).toEqual({ fromBaseMinor: 8_125_000, toBaseMinor: 8_089_840, costMinor: 35_160 });
  });

  it('shows what it posts at every keystroke of 500 and 638', () => {
    for (const out of typing('500')) {
      for (const into of typing('638')) {
        const draft = { ...start, amount: out, toAmount: into };
        const view = moveView(draft, accounts, 'IDR', rates);
        const post = formToPost(draft, accounts);
        if (post.kind !== 'post') throw new Error('expected a plain posting');
        const left = post.input.lines.find((line) => line.accountId === usd.id)!;
        const arrived = post.input.lines.find((line) => line.accountId === sgd.id)!;
        expect(left).toMatchObject({ currency: view.leaves.currency, amountMinor: -evaluateAmount(view.leaves.value, view.leaves.currency)! });
        expect(arrived).toMatchObject({ currency: view.arrives!.currency, amountMinor: evaluateAmount(view.arrives!.value, view.arrives!.currency)! });
        expect(view.cost!.fromBaseMinor - view.cost!.toBaseMinor).toBe(view.cost!.costMinor);
      }
    }
  });

  it('reads USD → IDR at each side’s own exponent, at every keystroke of 100.50 and 1.630.000', () => {
    // USD and SGD share an exponent, so the case above cannot catch a figure read in the other pocket’s currency.
    const toIdr = moveDraft('book', usd, idr, '2026-09-21');
    for (const out of typing('100.50')) {
      for (const into of typing('1.630.000')) {
        const draft = { ...toIdr, amount: out, toAmount: into };
        const view = moveView(draft, accounts, 'IDR', rates);
        const outMinor = evaluateAmount(view.leaves.value, view.leaves.currency);
        const intoMinor = evaluateAmount(view.arrives!.value, view.arrives!.currency);
        if (outMinor === null || intoMinor === null) {
          expect(view.cost).toBeNull();
          expect(() => formToPost(draft, accounts)).toThrow();
          continue;
        }
        const post = formToPost(draft, accounts);
        if (post.kind !== 'post') throw new Error('expected a plain posting');
        expect(post.input.lines.find((line) => line.accountId === usd.id)).toMatchObject({ currency: 'USD', amountMinor: -outMinor });
        expect(post.input.lines.find((line) => line.accountId === idr.id)).toMatchObject({ currency: 'IDR', amountMinor: intoMinor });
      }
    }
    const done = moveView({ ...toIdr, amount: '100.50', toAmount: '1.630.000' }, accounts, 'IDR', rates);
    expect(done.cost).toEqual({ fromBaseMinor: 1_633_125, toBaseMinor: 1_630_000, costMinor: 3_125 });
  });

  it('clears both figures when a pocket changes, and swaps when the other side is chosen', () => {
    const typed = { ...start, amount: '500', toAmount: '638' };
    expect(withPockets(typed, { toId: idr.id })).toMatchObject({ moneyId: usd.id, toId: idr.id, amount: '', toAmount: '' });
    expect(withPockets(typed, { moneyId: sgd.id })).toMatchObject({ moneyId: sgd.id, toId: usd.id, amount: '', toAmount: '' });
  });

  it('says a cost, a gain and a match in words, with one positive figure', () => {
    const idrFormat = (minor: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(minor);
    expect(spreadLine({ fromBaseMinor: 8_125_000, toBaseMinor: 8_089_840, costMinor: 35_160 }, 'IDR')).toEqual({ title: 'The bank’s rate cost you', figure: idrFormat(35_160) });
    expect(spreadLine({ fromBaseMinor: 8_125_000, toBaseMinor: 8_242_000, costMinor: -117_000 }, 'IDR')).toEqual({ title: 'The bank’s rate gained you', figure: idrFormat(117_000) });
    expect(spreadLine({ fromBaseMinor: 1, toBaseMinor: 1, costMinor: 0 }, 'IDR')!.title).toBe('The bank’s rate matched the day’s rate');
    expect(spreadLine(null, 'IDR')).toBeNull();
  });

  it('writes the bank’s rate to four places', () => {
    expect(bankRateText(1.276, 'USD', 'SGD')).toBe('1 USD = 1,2760 SGD');
    expect(bankRateText(null, 'USD', 'SGD')).toBe('—');
  });
});

describe('the Money tile', () => {
  const book = [
    ...accounts,
    { id: 'm', name: 'Dollar Saver', parentId: null, kind: 'asset', subtype: 'savings', currency: 'USD', archivedAt: null, sortOrder: 0 },
    { id: 'k', name: 'Cash', parentId: null, kind: 'asset', subtype: 'cash', currency: 'IDR', archivedAt: null, sortOrder: 0 },
    { id: 'o', name: 'Overdrawn', parentId: null, kind: 'asset', subtype: 'bank', currency: 'IDR', archivedAt: null, sortOrder: 0 },
    { id: 'shares', name: 'US shares', parentId: null, kind: 'asset', subtype: 'investment', currency: 'USD', archivedAt: null, sortOrder: 0 },
    { id: 'visa', name: 'Visa', parentId: null, kind: 'liability', subtype: 'credit_card', currency: 'IDR', archivedAt: null, sortOrder: 0 },
    { id: 'gone', name: 'Old', parentId: null, kind: 'asset', subtype: 'bank', currency: 'EUR', archivedAt: '2026-01-01', sortOrder: 0 },
  ] as AccountRow[];
  const balances = {
    'c-usd': 240_000, // $2.400,00 → 39.000.000
    'a-sgd': 115_000, // S$1.150,00 → 14.582.000
    'b-idr': 5_400_000,
    'd-jpy': 999_999, // archived pocket: not counted
    m: 180_000, // $1.800,00 → 29.250.000 (rounding is pinned in sumToBase's and approxLine's own tests, off .5)
    k: 15_750_000,
    o: -100_000, // overdrawn: lowers the figure
    shares: 1_000_000, // a holding: not money
    visa: -2_000_000, // a debt: not money
  };

  it('adds every money account and every pocket at today’s rates — an account with pockets is one account', () => {
    // 39.000.000 + 14.582.000 + 5.400.000 + 29.250.000 + 15.750.000 − 100.000 — the mockup's Rp 103.882.000.
    // Wrong answers it rules out: Math.abs on the overdrawn account (104.082.000), the holding counted (+16.250.000),
    // the card counted, the archived JPY pocket counted, the parent's own zero counted as an account of its own.
    expect(moneySummary(book, balances, 'IDR', rates)).toEqual({ totalMinor: 103_882_000, missing: [], accounts: 4, currencies: 3 });
  });

  it('gives no figure when a rate is missing, and names it — not the sum of the rest, not raw minor units', () => {
    expect(moneySummary(book, balances, 'IDR', { USD: 16_250 })).toEqual({ totalMinor: null, missing: ['SGD'], accounts: 4, currencies: 3 });
  });
});
