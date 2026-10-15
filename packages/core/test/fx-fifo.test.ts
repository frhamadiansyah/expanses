import { describe, expect, it } from 'vitest';
import {
  chronological,
  EXCHANGE_GAIN_KEY,
  EXCHANGE_LOSS_KEY,
  fifoCosts,
  FxError,
  type FxMovement,
  isExchangeResultKey,
  isFxLotAccount,
  shareOf,
} from '../src/index';

/*
 * Withdrawal rate §3–§4. A lira pocket (TRY, in kuruş) in a rupiah book (IDR has no minor unit here). Every figure is
 * invented: withdrawals at 525 and 540 rupiah per lira against a market rate of 512.
 */

const at = (occurredOn: string, minute = 0) => `${occurredOn}T08:${String(minute).padStart(2, '0')}:00.000Z`;
const inflow = (entryId: string, occurredOn: string, minor: number, costBaseMinor: number, over: Partial<Extract<FxMovement, { kind: 'in' }>> = {}): FxMovement => ({
  kind: 'in',
  entryId,
  occurredOn,
  dayOrder: null,
  createdAt: at(occurredOn),
  minor,
  costBaseMinor,
  ...over,
});
const outflow = (entryId: string, occurredOn: string, minor: number, dayValueBaseMinor: number, over: Partial<Extract<FxMovement, { kind: 'out' }>> = {}): FxMovement => ({
  kind: 'out',
  entryId,
  occurredOn,
  dayOrder: null,
  createdAt: at(occurredOn, 30),
  minor,
  dayValueBaseMinor,
  ...over,
});

describe('fifoCosts', () => {
  it('spends the oldest withdrawal first, at what it cost', () => {
    // ₺1.000 at 525 on 2 Nov, ₺1.000 at 540 on 9 Nov; ₺1.500 spent on 12 Nov (posted at the day's 512: Rp 768.000).
    const result = fifoCosts([inflow('w1', '2026-11-02', 100_000, 525_000), inflow('w2', '2026-11-09', 100_000, 540_000), outflow('s1', '2026-11-12', 150_000, 768_000)]);
    expect(result.outs).toEqual([
      {
        entryId: 's1',
        costBaseMinor: 795_000,
        uses: [
          { lotId: 'w1', minor: 100_000, costBaseMinor: 525_000 },
          { lotId: 'w2', minor: 50_000, costBaseMinor: 270_000 },
        ],
        uncoveredMinor: 0,
        uncoveredBaseMinor: 0,
      },
    ]);
    expect(result.open).toEqual([{ lotId: 'w2', lotDate: '2026-11-09', minor: 100_000, costBaseMinor: 540_000, leftMinor: 50_000, leftCostBaseMinor: 270_000 }]);
    expect(result.shortfalls).toEqual([]);
  });

  it('values what no withdrawal covers at the figure it was posted at, and says so (R4)', () => {
    // ₺200 withdrawn at 525; ₺500 spent, posted at Rp 256.000. ₺300 is uncovered: 3/5 of 256.000.
    const result = fifoCosts([inflow('w1', '2026-11-02', 20_000, 105_000), outflow('s1', '2026-11-03', 50_000, 256_000)]);
    expect(result.outs[0]).toEqual({
      entryId: 's1',
      costBaseMinor: 258_600,
      uses: [{ lotId: 'w1', minor: 20_000, costBaseMinor: 105_000 }],
      uncoveredMinor: 30_000,
      uncoveredBaseMinor: 153_600,
    });
    expect(result.shortfalls).toEqual([{ entryId: 's1', uncoveredMinor: 30_000 }]);
    expect(result.open).toEqual([]);
  });

  it('keeps every figure of an account that never recorded a withdrawal', () => {
    const result = fifoCosts([outflow('s1', '2026-11-03', 45_000, 230_400)]);
    expect(result.outs[0]!.costBaseMinor).toBe(230_400);
    expect(result.shortfalls).toEqual([{ entryId: 's1', uncoveredMinor: 45_000 }]);
  });

  it('takes money in before money out on the same day, whatever order they were recorded in', () => {
    const result = fifoCosts([outflow('s1', '2026-11-02', 10_000, 51_200, { createdAt: at('2026-11-02', 1) }), inflow('w1', '2026-11-02', 100_000, 525_000, { createdAt: at('2026-11-02', 9) })]);
    expect(result.outs[0]).toMatchObject({ costBaseMinor: 52_500, uncoveredMinor: 0 });
  });

  it('reads a day from the bottom of its list up: the row dragged lower happened earlier (R3)', () => {
    // a is shown above b (position 1 before 2), so b came first and takes the older lot.
    const result = fifoCosts([
      inflow('w1', '2026-11-01', 10_000, 50_000, { createdAt: at('2026-11-01', 1) }),
      inflow('w2', '2026-11-01', 10_000, 60_000, { createdAt: at('2026-11-01', 2) }),
      outflow('a', '2026-11-02', 10_000, 51_200, { dayOrder: 1 }),
      outflow('b', '2026-11-02', 10_000, 51_200, { dayOrder: 2 }),
    ]);
    expect(result.outs.map((out) => [out.entryId, out.costBaseMinor])).toEqual([
      ['b', 50_000],
      ['a', 60_000],
    ]);
  });

  it('spends lots moved in from another pocket by their own withdrawal dates, oldest first (§3)', () => {
    const result = fifoCosts([
      inflow('own', '2026-11-05', 10_000, 54_000),
      inflow('moved', '2026-11-08', 10_000, 52_500, { parts: [{ lotId: 'w-old', lotDate: '2026-11-01', minor: 10_000, costBaseMinor: 52_500 }] }),
      outflow('s1', '2026-11-09', 10_000, 51_200),
    ]);
    expect(result.outs[0]!.uses).toEqual([{ lotId: 'w-old', minor: 10_000, costBaseMinor: 52_500 }]);
    expect(result.open.map((lot) => lot.lotId)).toEqual(['own']);
  });

  it('starts from the lots open at the start (R17)', () => {
    const result = fifoCosts([outflow('s1', '2026-11-03', 5_000, 25_600)], [{ lotId: 'before', lotDate: '2026-10-30', minor: 10_000, costBaseMinor: 52_000 }]);
    expect(result.outs[0]!.costBaseMinor).toBe(26_000);
    expect(result.open).toEqual([{ lotId: 'before', lotDate: '2026-10-30', minor: 10_000, costBaseMinor: 52_000, leftMinor: 5_000, leftCostBaseMinor: 26_000 }]);
  });

  it('names one lot once in an outflow, however many pieces of it arrived', () => {
    const result = fifoCosts([
      inflow('m1', '2026-11-02', 5_000, 26_250, { parts: [{ lotId: 'w', lotDate: '2026-11-01', minor: 5_000, costBaseMinor: 26_250 }] }),
      inflow('m2', '2026-11-03', 5_000, 26_250, { parts: [{ lotId: 'w', lotDate: '2026-11-01', minor: 5_000, costBaseMinor: 26_250 }] }),
      outflow('s1', '2026-11-04', 10_000, 51_200),
    ]);
    expect(result.outs[0]!.uses).toEqual([{ lotId: 'w', minor: 10_000, costBaseMinor: 52_500 }]);
  });

  it('refuses a movement that is not a positive whole number, and parts that do not add up', () => {
    expect(() => fifoCosts([outflow('s1', '2026-11-03', 0, 0)])).toThrow(FxError);
    expect(() => fifoCosts([outflow('s1', '2026-11-03', 1.5, 7)])).toThrow(FxError);
    expect(() => fifoCosts([inflow('m', '2026-11-03', 10_000, 52_500, { parts: [{ lotId: 'w', lotDate: '2026-11-01', minor: 9_000, costBaseMinor: 52_500 }] })])).toThrow(FxError);
    expect(() => fifoCosts([inflow('x', '2026-11-03', 10, 52), outflow('x', '2026-11-04', 5, 26)])).toThrow(FxError);
  });
});

describe('shareOf', () => {
  it('gives a lot’s pieces that always add up to its cost', () => {
    expect([shareOf(100, 1, 3), shareOf(100, 2, 3) - shareOf(100, 1, 3), 100 - shareOf(100, 2, 3)]).toEqual([33, 34, 33]);
    expect(shareOf(-100, 1, 3)).toBe(-33);
    expect(shareOf(0, 1, 3)).toBe(0);
  });

  it('keeps every unit of a figure past 2^53 halfway through', () => {
    expect(shareOf(9_007_199_254_740_991, 1, 2)).toBe(4_503_599_627_370_496);
  });
});

describe('chronological', () => {
  it('is date, then money in, then the list read bottom-up, then entry id', () => {
    const rows = [outflow('b', '2026-11-02', 1, 1), inflow('a', '2026-11-02', 1, 1), outflow('c', '2026-11-01', 1, 1)];
    expect([...rows].sort(chronological).map((row) => row.entryId)).toEqual(['c', 'a', 'b']);
  });
});

describe('which accounts hold lots (R2)', () => {
  it('is foreign money of the owner’s own, never a card, a debt or a trip balance', () => {
    expect(isFxLotAccount({ kind: 'asset', subtype: 'cash', currency: 'TRY' }, 'IDR')).toBe(true);
    expect(isFxLotAccount({ kind: 'asset', subtype: 'time_deposit', currency: 'USD' }, 'IDR')).toBe(true);
    expect(isFxLotAccount({ kind: 'asset', subtype: 'bank', currency: 'IDR' }, 'IDR')).toBe(false);
    expect(isFxLotAccount({ kind: 'liability', subtype: 'credit_card', currency: 'TRY' }, 'IDR')).toBe(false);
    expect(isFxLotAccount({ kind: 'asset', subtype: 'receivable', currency: 'TRY' }, 'IDR')).toBe(false);
    expect(isFxLotAccount({ kind: 'asset', subtype: 'event_balance', currency: 'TRY' }, 'IDR')).toBe(false);
    expect(isFxLotAccount({ kind: 'asset', subtype: 'cash', currency: null }, 'IDR')).toBe(false);
  });

  it('knows the two exchange categories by key', () => {
    expect(isExchangeResultKey(EXCHANGE_GAIN_KEY)).toBe(true);
    expect(isExchangeResultKey(EXCHANGE_LOSS_KEY)).toBe(true);
    expect(isExchangeResultKey('income.other')).toBe(false);
    expect(isExchangeResultKey(null)).toBe(false);
  });
});
