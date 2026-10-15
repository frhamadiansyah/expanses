import { describe, expect, it } from 'vitest';
import {
  balances,
  expenseInEvent,
  type ExpenseRecord,
  fewestPayments,
  isRateString,
  myExpenseLines,
  mySettlementLines,
  parseSplitJson,
  rateString,
  SharedEventError,
  sharesOf,
  splitJsonOf,
  toEvent,
} from '../src/index';

/*
 * Shared events (spec §4, §5). A week by the coast in lira (TRY): Rina, Andi and Budi (Budi without the app). Every
 * figure here is invented: 1 EUR = 31.5 TRY on the day, amounts in minor units (cents, kuruş).
 */

const expense = (over: Partial<ExpenseRecord> = {}): ExpenseRecord => ({
  id: 'exp-1',
  amountMinor: 9_000,
  currency: 'EUR',
  rateToEvent: '31.5',
  payerPersonId: 'rina',
  split: { mode: 'equal', people: ['rina', 'andi', 'budi'] },
  voided: false,
  ...over,
});

describe('sharesOf', () => {
  it('splits equally, the leftover going to the payer when the payer is in the split', () => {
    expect(sharesOf({ amountMinor: 100, payerPersonId: 'andi', split: { mode: 'equal', people: ['rina', 'andi', 'budi'] } })).toEqual([
      { personId: 'rina', minor: 33 },
      { personId: 'andi', minor: 34 },
      { personId: 'budi', minor: 33 },
    ]);
  });

  it('gives the leftover to the first person in the split when the payer is not in it', () => {
    expect(sharesOf({ amountMinor: 101, payerPersonId: 'rina', split: { mode: 'equal', people: ['andi', 'budi'] } })).toEqual([
      { personId: 'andi', minor: 51 },
      { personId: 'budi', minor: 50 },
    ]);
  });

  it('takes amounts as given when they add up to the total, and refuses them when they do not', () => {
    const split = { mode: 'amounts' as const, shares: [{ personId: 'rina', minor: 40 }, { personId: 'andi', minor: 60 }] };
    expect(sharesOf({ amountMinor: 100, payerPersonId: 'rina', split })).toEqual(split.shares);
    expect(() => sharesOf({ amountMinor: 101, payerPersonId: 'rina', split })).toThrow(expect.objectContaining({ code: 'SPLIT_MISMATCH' }));
  });

  it('refuses an empty split, a person named twice and an amount that is not above zero', () => {
    expect(() => sharesOf({ amountMinor: 100, payerPersonId: 'rina', split: { mode: 'equal', people: [] } })).toThrow(SharedEventError);
    expect(() => sharesOf({ amountMinor: 100, payerPersonId: 'rina', split: { mode: 'equal', people: ['rina', 'rina'] } })).toThrow(expect.objectContaining({ code: 'DUPLICATE_PERSON' }));
    expect(() => sharesOf({ amountMinor: 0, payerPersonId: 'rina', split: { mode: 'equal', people: ['rina'] } })).toThrow(expect.objectContaining({ code: 'BAD_AMOUNT' }));
  });
});

describe('rates and conversion', () => {
  it('reads the decimal-string rate format and writes it back without exponents', () => {
    expect(isRateString('31.5')).toBe(true);
    expect(isRateString('1')).toBe(true);
    expect(isRateString('0')).toBe(false);
    expect(isRateString('1e-7')).toBe(false);
    expect(isRateString('31,5')).toBe(false);
    expect(rateString(0.0000625)).toBe('0.0000625');
    expect(rateString(31.5)).toBe('31.5');
    expect(() => rateString(0)).toThrow(expect.objectContaining({ code: 'BAD_RATE' }));
  });

  it('converts half away from zero, and keeps the event currency at rate 1 only', () => {
    expect(toEvent(3_000, 'EUR', '31.5', 'TRY')).toBe(94_500);
    expect(toEvent(1, 'EUR', '0.5', 'TRY')).toBe(1); // 0.5 rounds away from zero
    expect(toEvent(12_345, 'TRY', '1', 'TRY')).toBe(12_345);
    expect(() => toEvent(100, 'TRY', '2', 'TRY')).toThrow(expect.objectContaining({ code: 'BAD_RATE' }));
  });

  it('makes the payer’s paid figure the sum of the converted shares', () => {
    const { paidMinor, shares } = expenseInEvent(expense({ amountMinor: 100, rateToEvent: '0.333' }), 'TRY');
    expect(shares.map((s) => s.minor)).toEqual([11, 11, 11]); // 34 for Rina × 0.333 = 11.32 → 11; 33 × 0.333 = 10.99 → 11
    expect(paidMinor).toBe(33);
  });
});

describe('balances and fewest payments', () => {
  it('reads paid minus own shares plus settlements paid minus received, summing to zero', () => {
    const out = balances(
      [expense(), expense({ id: 'exp-2', amountMinor: 60_000, currency: 'TRY', rateToEvent: '1', payerPersonId: 'andi', split: { mode: 'equal', people: ['rina', 'andi'] } })],
      [{ id: 'set-1', fromPersonId: 'budi', toPersonId: 'rina', amountMinor: 50_000, voided: false }],
      'TRY',
      ['rina', 'andi', 'budi', 'dewi'],
    );
    // Rina paid €90 (283,500 TRY in shares of 94,500), owes 94,500 of it and 30,000 of Andi's dinner, and was paid 50,000.
    expect(out).toEqual({ rina: 283_500 - 94_500 - 30_000 - 50_000, andi: 60_000 - 94_500 - 30_000, budi: -94_500 + 50_000, dewi: 0 });
    expect(Object.values(out).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('ignores voided records', () => {
    expect(balances([expense({ voided: true })], [], 'TRY')).toEqual({});
  });

  it('suggests the fewest payments, largest debtor to largest creditor, ties by person id', () => {
    expect(fewestPayments({ rina: 480_000, andi: -290_000, budi: -190_000, dewi: 0 })).toEqual([
      { fromPersonId: 'andi', toPersonId: 'rina', amountMinor: 290_000 },
      { fromPersonId: 'budi', toPersonId: 'rina', amountMinor: 190_000 },
    ]);
    expect(fewestPayments({ b: -100, a: -100, c: 200 })).toEqual([
      { fromPersonId: 'a', toPersonId: 'c', amountMinor: 100 },
      { fromPersonId: 'b', toPersonId: 'c', amountMinor: 100 },
    ]);
  });

  it('refuses balances that do not sum to zero', () => {
    expect(() => fewestPayments({ rina: 10, andi: -9 })).toThrow(expect.objectContaining({ code: 'UNBALANCED' }));
  });
});

describe('split json', () => {
  it('round-trips both modes in the shape the spec gives', () => {
    expect(splitJsonOf({ mode: 'equal', people: ['rina', 'andi'] })).toBe('["rina","andi"]');
    expect(splitJsonOf({ mode: 'amounts', shares: [{ personId: 'rina', minor: 5 }] })).toBe('[{"personId":"rina","minor":5}]');
    expect(parseSplitJson('equal', '["rina","andi"]')).toEqual({ mode: 'equal', people: ['rina', 'andi'] });
    expect(parseSplitJson('amounts', '[{"personId":"rina","minor":5}]')).toEqual({ mode: 'amounts', shares: [{ personId: 'rina', minor: 5 }] });
    expect(() => parseSplitJson('equal', '{"x":1}')).toThrow(SharedEventError);
  });
});

const accounts = { shareAccountId: 'share', eventBalanceAccountId: 'trip', exchangeAccountId: 'fx' };

describe('myExpenseLines (spec §5)', () => {
  it('I paid from a euro wallet: wallet −90, my share +30, the others’ converted shares on the trip balance, exchange between', () => {
    const out = myExpenseLines({ expense: expense(), eventCurrency: 'TRY', me: 'rina', accounts, paidFrom: { accountId: 'wallet', currency: 'EUR', chargedMinor: 9_000 } });
    expect(out).toEqual({
      kind: 'lines',
      lines: [
        { accountId: 'wallet', amountMinor: -9_000, currency: 'EUR' },
        { accountId: 'share', amountMinor: 3_000, currency: 'EUR' },
        { accountId: 'trip', amountMinor: 189_000, currency: 'TRY' },
        { accountId: 'fx', amountMinor: 6_000, currency: 'EUR' },
        { accountId: 'fx', amountMinor: -189_000, currency: 'TRY' },
      ],
    });
  });

  it('someone else paid and I am in the split: my share, the trip balance down by its converted figure', () => {
    const out = myExpenseLines({ expense: expense(), eventCurrency: 'TRY', me: 'andi', accounts, paidFrom: null });
    expect(out).toEqual({
      kind: 'lines',
      lines: [
        { accountId: 'share', amountMinor: 3_000, currency: 'EUR' },
        { accountId: 'trip', amountMinor: -94_500, currency: 'TRY' },
        { accountId: 'fx', amountMinor: -3_000, currency: 'EUR' },
        { accountId: 'fx', amountMinor: 94_500, currency: 'TRY' },
      ],
    });
  });

  it('not the payer and not in the split: nothing; the payer without the paying account here: needs an account', () => {
    expect(myExpenseLines({ expense: expense(), eventCurrency: 'TRY', me: 'dewi', accounts, paidFrom: null })).toEqual({ kind: 'none' });
    expect(myExpenseLines({ expense: expense(), eventCurrency: 'TRY', me: 'rina', accounts, paidFrom: null })).toEqual({ kind: 'needs-account' });
  });

  it('a card charged in another currency keeps the card line’s earning category', () => {
    const out = myExpenseLines({
      expense: expense({ currency: 'TRY', amountMinor: 30_000, rateToEvent: '1', split: { mode: 'equal', people: ['rina'] } }),
      eventCurrency: 'TRY',
      me: 'rina',
      accounts,
      paidFrom: { accountId: 'card', currency: 'IDR', chargedMinor: 150_000, spendCategoryId: 'restaurants' },
    });
    expect(out).toEqual({
      kind: 'lines',
      lines: [
        { accountId: 'card', amountMinor: -150_000, currency: 'IDR', spendCategoryId: 'restaurants' },
        { accountId: 'share', amountMinor: 30_000, currency: 'TRY' },
        { accountId: 'fx', amountMinor: 150_000, currency: 'IDR' },
        { accountId: 'fx', amountMinor: -30_000, currency: 'TRY' },
      ],
    });
  });

  it('a voided expense posts nothing', () => {
    expect(myExpenseLines({ expense: expense({ voided: true }), eventCurrency: 'TRY', me: 'andi', accounts, paidFrom: null })).toEqual({ kind: 'none' });
  });
});

describe('mySettlementLines (spec §5)', () => {
  const settlement = { id: 'set-1', fromPersonId: 'andi', toPersonId: 'rina', amountMinor: 290_000, voided: false };

  it('paying from a rupiah bank: bank down by what it paid, trip balance up by the lira figure', () => {
    expect(mySettlementLines({ settlement, eventCurrency: 'TRY', me: 'andi', eventBalanceAccountId: 'trip', exchangeAccountId: 'fx', account: { accountId: 'bank', currency: 'IDR', amountMinor: 1_450_000 } })).toEqual({
      kind: 'lines',
      lines: [
        { accountId: 'bank', amountMinor: -1_450_000, currency: 'IDR' },
        { accountId: 'trip', amountMinor: 290_000, currency: 'TRY' },
        { accountId: 'fx', amountMinor: 1_450_000, currency: 'IDR' },
        { accountId: 'fx', amountMinor: -290_000, currency: 'TRY' },
      ],
    });
  });

  it('receiving into a lira wallet needs no exchange; a third person posts nothing; a party with no account needs one', () => {
    expect(mySettlementLines({ settlement, eventCurrency: 'TRY', me: 'rina', eventBalanceAccountId: 'trip', exchangeAccountId: 'fx', account: { accountId: 'wallet', currency: 'TRY', amountMinor: 290_000 } })).toEqual({
      kind: 'lines',
      lines: [
        { accountId: 'wallet', amountMinor: 290_000, currency: 'TRY' },
        { accountId: 'trip', amountMinor: -290_000, currency: 'TRY' },
      ],
    });
    expect(mySettlementLines({ settlement, eventCurrency: 'TRY', me: 'budi', eventBalanceAccountId: 'trip', exchangeAccountId: 'fx', account: null })).toEqual({ kind: 'none' });
    expect(mySettlementLines({ settlement, eventCurrency: 'TRY', me: 'rina', eventBalanceAccountId: 'trip', exchangeAccountId: 'fx', account: null })).toEqual({ kind: 'needs-account' });
  });

  it('refuses a settlement from a person to the same person', () => {
    expect(() =>
      mySettlementLines({ settlement: { ...settlement, toPersonId: 'andi' }, eventCurrency: 'TRY', me: 'andi', eventBalanceAccountId: 'trip', exchangeAccountId: 'fx', account: null }),
    ).toThrow(expect.objectContaining({ code: 'BAD_SETTLEMENT' }));
  });
});
