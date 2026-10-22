import { describe, expect, it } from 'vitest';
import { GoalError, goalMoneyOf, goalShares, goalUnitsOf, resplitFits, splitFits, type TradeRecord, UNTAGGED } from '../src/index';

let seq = 0;
function trade(partial: Partial<TradeRecord> & Pick<TradeRecord, 'kind' | 'occurredOn'>): TradeRecord {
  seq += 1;
  return { id: `t${seq}`, accountId: 'bbca', createdAt: `2026-01-01T00:00:${String(seq).padStart(2, '0')}Z`, unitsMicro: 0, grossMinor: 0, feeMinor: 0, taxMinor: 0, ...partial };
}
const LOT = 100_000_000; // 100 shares, in micro-units
const part = (goalId: string, lots: number, moneyMinor = 0) => ({ goalId, unitsMicro: lots * LOT, moneyMinor });

// 8 lots of a share at Rp8.900, Rp10.680 of fee: Rp7.130.680 out of the account.
const eightLots = (parts = [part('emergency', 5), part('education', 3)]) =>
  trade({ kind: 'buy', occurredOn: '2026-10-20', unitsMicro: 8 * LOT, grossMinor: 7_120_000, feeMinor: 10_680, goalId: null, goalParts: parts });

describe('a buy split between goals', () => {
  it('gives each goal its lots', () => {
    expect(goalUnitsOf([eightLots()]).byGoal).toEqual({ emergency: 5 * LOT, education: 3 * LOT });
  });

  it('leaves what no part takes with no goal', () => {
    expect(goalUnitsOf([eightLots([part('emergency', 5)])]).byGoal).toEqual({ emergency: 5 * LOT, [UNTAGGED]: 3 * LOT });
  });

  it('shares the whole outflow, fee included, by lots, and the shares add up exactly', () => {
    const shares = goalShares(eightLots(), 7_130_680);
    expect(shares).toEqual([
      ['emergency', 4_456_675],
      ['education', 2_674_005],
    ]);
    expect(shares.reduce((sum, [, minor]) => sum + minor, 0)).toBe(7_130_680);
  });

  it('puts a rupiah of rounding on the largest share', () => {
    const odd = trade({ kind: 'buy', occurredOn: '2026-10-20', unitsMicro: 3 * LOT, grossMinor: 100, goalId: null, goalParts: [part('a', 1), part('b', 1), part('c', 1)] });
    expect(goalShares(odd, 100).map(([, minor]) => minor).sort()).toEqual([33, 33, 34]);
  });

  it('is unchanged for a buy with one goal', () => {
    const single = trade({ kind: 'buy', occurredOn: '2026-10-20', unitsMicro: 8 * LOT, grossMinor: 7_120_000, goalId: 'hajj' });
    expect(goalShares(single, 7_130_680)).toEqual([['hajj', 7_130_680]]);
    expect(goalUnitsOf([single]).byGoal).toEqual({ hajj: 8 * LOT });
  });
});

describe('a sell split between goals', () => {
  it('takes each part from its own goal', () => {
    const sale = trade({ kind: 'sell', occurredOn: '2026-11-01', unitsMicro: 6 * LOT, grossMinor: 5_640_000, goalId: null, goalParts: [part('emergency', 4), part('education', 2)] });
    expect(goalUnitsOf([eightLots(), sale]).byGoal).toEqual({ emergency: 1 * LOT, education: 1 * LOT });
  });

  it('refuses a part that takes more than its goal holds, even when the holding has enough', () => {
    const sale = trade({ kind: 'sell', occurredOn: '2026-11-01', unitsMicro: 4 * LOT, grossMinor: 3_760_000, goalId: null, goalParts: [part('education', 4)] });
    expect(() => goalUnitsOf([eightLots(), sale])).toThrow(GoalError);
  });

  it('a bonus issue scales each goal’s lots', () => {
    const bonus = trade({ kind: 'unit_change', occurredOn: '2026-11-01', unitsMicro: 8 * LOT });
    expect(goalUnitsOf([eightLots(), bonus]).byGoal).toEqual({ emergency: 10 * LOT, education: 6 * LOT });
  });
});

describe('a fund tracked by money, split by amount', () => {
  const fundBuy = trade({
    kind: 'buy',
    occurredOn: '2026-10-01',
    unitsMicro: 0,
    grossMinor: 1_000_000,
    feeMinor: 0,
    goalId: null,
    goalParts: [
      { goalId: 'emergency', unitsMicro: 0, moneyMinor: 600_000 },
      { goalId: 'hajj', unitsMicro: 0, moneyMinor: 400_000 },
    ],
  });

  it('puts each goal’s amount in', () => {
    expect(goalMoneyOf([fundBuy]).byGoal).toEqual({ emergency: 600_000, hajj: 400_000 });
  });

  it('a split sell takes each part’s share of the money out', () => {
    const sale = trade({
      kind: 'sell',
      occurredOn: '2026-10-15',
      unitsMicro: 0,
      grossMinor: 500_000,
      basisMinor: 500_000,
      goalId: null,
      goalParts: [
        { goalId: 'emergency', unitsMicro: 0, moneyMinor: 300_000 },
        { goalId: 'hajj', unitsMicro: 0, moneyMinor: 200_000 },
      ],
    });
    expect(goalMoneyOf([fundBuy, sale]).byGoal).toEqual({ emergency: 300_000, hajj: 200_000 });
  });
});

describe('splitFits and resplitFits', () => {
  it('refuses parts that take more than the trade, name a goal twice, or take nothing', () => {
    const t = { unitsMicro: 8 * LOT, grossMinor: 7_120_000 };
    expect(splitFits(t, [part('a', 5), part('b', 3)], false)).toBe(true);
    expect(splitFits(t, [part('a', 5), part('b', 4)], false)).toBe(false);
    expect(splitFits(t, [part('a', 5), part('a', 1)], false)).toBe(false);
    expect(splitFits(t, [part('a', 0)], false)).toBe(false);
    expect(splitFits(t, [{ goalId: 'a', unitsMicro: 0, moneyMinor: 8_000_000 }], true)).toBe(false);
  });

  it('refuses a re-split that would leave a goal short of a later sell', () => {
    const bought = eightLots();
    const sale = trade({ kind: 'sell', occurredOn: '2026-11-01', unitsMicro: 4 * LOT, grossMinor: 3_760_000, goalId: 'emergency' });
    expect(resplitFits([bought, sale], bought.id, [part('emergency', 4), part('education', 4)])).toBe(true);
    expect(resplitFits([bought, sale], bought.id, [part('emergency', 3), part('education', 5)])).toBe(false);
  });
});
