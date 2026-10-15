import { describe, expect, it } from 'vitest';
import { classifyInflow, FxError, type FxLine, revalueTransaction, spreadBase } from '../src/index';

/*
 * Withdrawal rate §4, §5. Invented figures: lira withdrawn at 525, a market rate of 512, euros at 17.500, a rupiah book.
 * Each line is [entryId, currency, amount, stored base, role].
 */
const line = (entryId: string, currency: string, amountMinor: number, amountBaseMinor: number, role: FxLine['role']): FxLine => ({ entryId, currency, amountMinor, amountBaseMinor, role });

describe('spreadBase', () => {
  it('shares a figure by weight and gives the whole remainder to the largest, first on a tie (R5)', () => {
    expect(spreadBase(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(spreadBase(-7, [2, 5])).toEqual([-2, -5]);
    expect(spreadBase(10, [0, 0])).toEqual([10, 0]);
    expect(() => spreadBase(10, [])).toThrow(FxError);
  });
});

describe('revalueTransaction: spending (§4 row 1)', () => {
  it('puts the cost on the money line and shares it over the categories by their day figures', () => {
    const lines = [line('pocket', 'TRY', -45_000, -230_400, 'lot'), line('food', 'TRY', 30_000, 153_600, 'other'), line('taxi', 'TRY', 15_000, 76_800, 'other')];
    expect(revalueTransaction({ lines, baseCurrency: 'IDR', outCosts: { pocket: 236_250 } })).toEqual({
      bases: { pocket: -236_250, food: 157_500, taxi: 78_750 },
      gainLossBaseMinor: 0,
    });
  });

  it('adds a split up to the money line exactly, the remainder on the largest line (Review Focus 4)', () => {
    const lines = [line('pocket', 'TRY', -30_000, -153_600, 'lot'), line('a', 'TRY', 10_000, 51_200, 'other'), line('b', 'TRY', 10_000, 51_200, 'other'), line('c', 'TRY', 10_000, 51_200, 'other')];
    const { bases } = revalueTransaction({ lines, baseCurrency: 'IDR', outCosts: { pocket: 100_001 } });
    expect(bases).toEqual({ pocket: -100_001, a: 33_335, b: 33_333, c: 33_333 });
  });

  it('shares a shared event’s expense charged in another currency over its share and trip balance, with no gain or loss (R7)', () => {
    const lines = [
      line('pocket', 'TRY', -90_000, -460_800, 'lot'),
      line('xTRY', 'TRY', 90_000, 460_800, 'exchange'),
      line('share', 'EUR', 1_000, 170_000, 'other'),
      line('trip', 'EUR', 2_000, 340_000, 'other'),
      line('xEUR', 'EUR', -3_000, -510_000, 'exchange'),
    ];
    expect(revalueTransaction({ lines, baseCurrency: 'IDR', outCosts: { pocket: 472_500 } })).toEqual({
      bases: { pocket: -472_500, xTRY: 472_500, share: 157_500, trip: 315_000, xEUR: -472_500 },
      gainLossBaseMinor: 0,
    });
  });

  it('keeps a base-currency bill at its own figure and books the difference (R7)', () => {
    const lines = [line('pocket', 'TRY', -45_000, -230_400, 'lot'), line('xTRY', 'TRY', 45_000, 230_400, 'exchange'), line('bill', 'IDR', 236_000, 236_000, 'other'), line('xIDR', 'IDR', -236_000, -236_000, 'exchange')];
    const result = revalueTransaction({ lines, baseCurrency: 'IDR', outCosts: { pocket: 236_250 } });
    expect(result.bases).toMatchObject({ bill: 236_000, xIDR: -236_000, xTRY: 236_250 });
    expect(result.gainLossBaseMinor).toBe(-250);
  });
});

describe('revalueTransaction: moves and exchanges', () => {
  it('carries the cost into another lira pocket (§4 row 3)', () => {
    const lines = [line('a', 'TRY', -50_000, -256_000, 'lot'), line('b', 'TRY', 50_000, 256_000, 'lot')];
    expect(revalueTransaction({ lines, baseCurrency: 'IDR', outCosts: { a: 262_500 } }).bases).toEqual({ a: -262_500, b: 262_500 });
  });

  it('pays a lira card at the lira’s cost, with no gain or loss (§4 row 4)', () => {
    const lines = [line('a', 'TRY', -50_000, -256_000, 'lot'), line('card', 'TRY', 50_000, 256_000, 'money')];
    expect(revalueTransaction({ lines, baseCurrency: 'IDR', outCosts: { a: 262_500 } })).toEqual({ bases: { a: -262_500, card: 262_500 }, gainLossBaseMinor: 0 });
  });

  it('changes leftovers back into rupiah: what arrived keeps its figure and the loss is the difference (§5)', () => {
    const lines = [line('pocket', 'TRY', -50_000, -256_000, 'lot'), line('xTRY', 'TRY', 50_000, 256_000, 'exchange'), line('bank', 'IDR', 250_000, 250_000, 'money'), line('xIDR', 'IDR', -250_000, -250_000, 'exchange')];
    expect(revalueTransaction({ lines, baseCurrency: 'IDR', outCosts: { pocket: 262_500 } })).toEqual({
      bases: { pocket: -262_500, xTRY: 262_500, bank: 250_000, xIDR: -250_000 },
      gainLossBaseMinor: -12_500,
    });
  });

  it('changes lira into euros: the euros keep their own figure, and the difference is booked (R6)', () => {
    const lines = [line('pocket', 'TRY', -100_000, -512_000, 'lot'), line('xTRY', 'TRY', 100_000, 512_000, 'exchange'), line('eur', 'EUR', 2_900, 507_500, 'lot'), line('xEUR', 'EUR', -2_900, -507_500, 'exchange')];
    expect(revalueTransaction({ lines, baseCurrency: 'IDR', outCosts: { pocket: 525_000 } })).toEqual({
      bases: { pocket: -525_000, xTRY: 525_000, eur: 507_500, xEUR: -507_500 },
      gainLossBaseMinor: -17_500,
    });
  });

  it('writes a withdrawal from rupiah at the rupiah that left (R11)', () => {
    const lines = [line('bank', 'IDR', -5_250_000, -5_250_000, 'money'), line('xIDR', 'IDR', 5_250_000, 5_250_000, 'exchange'), line('pocket', 'TRY', 1_000_000, 5_120_000, 'lot'), line('xTRY', 'TRY', -1_000_000, -5_120_000, 'exchange')];
    const cost = classifyInflow(lines, 'pocket', 'IDR');
    expect(cost).toEqual({ kind: 'exchanged', costs: { pocket: 5_250_000 } });
    expect(revalueTransaction({ lines, baseCurrency: 'IDR', inCosts: (cost as { costs: Record<string, number> }).costs })).toEqual({
      bases: { bank: -5_250_000, xIDR: 5_250_000, pocket: 5_250_000, xTRY: -5_250_000 },
      gainLossBaseMinor: 0,
    });
  });

  it('refuses what is not money leaving or arriving in a foreign account, and both at once', () => {
    const lines = [line('pocket', 'TRY', -45_000, -230_400, 'lot'), line('food', 'TRY', 45_000, 230_400, 'other')];
    expect(() => revalueTransaction({ lines, baseCurrency: 'IDR', outCosts: { food: 1 } })).toThrow(FxError);
    expect(() => revalueTransaction({ lines, baseCurrency: 'IDR', outCosts: { pocket: 1 }, inCosts: { pocket: 1 } })).toThrow(FxError);
  });
});

describe('classifyInflow (R11)', () => {
  it('is carried from another lira pocket, stored for income and for euros changed from lira, and stored for a settle-up', () => {
    expect(classifyInflow([line('a', 'TRY', -50_000, -256_000, 'lot'), line('b', 'TRY', 50_000, 256_000, 'lot')], 'b', 'IDR')).toEqual({ kind: 'carried', fromEntryIds: ['a'] });
    expect(classifyInflow([line('salary', 'TRY', -50_000, -256_000, 'other'), line('b', 'TRY', 50_000, 256_000, 'lot')], 'b', 'IDR')).toEqual({ kind: 'stored' });
    const lira = [line('pocket', 'TRY', -100_000, -512_000, 'lot'), line('xTRY', 'TRY', 100_000, 512_000, 'exchange'), line('eur', 'EUR', 2_900, 507_500, 'lot'), line('xEUR', 'EUR', -2_900, -507_500, 'exchange')];
    expect(classifyInflow(lira, 'eur', 'IDR')).toEqual({ kind: 'stored' });
    const settle = [line('trip', 'EUR', -1_000, -170_000, 'other'), line('xEUR', 'EUR', 1_000, 170_000, 'exchange'), line('pocket', 'TRY', 33_000, 168_960, 'lot'), line('xTRY', 'TRY', -33_000, -168_960, 'exchange')];
    expect(classifyInflow(settle, 'pocket', 'IDR')).toEqual({ kind: 'stored' });
  });
});
