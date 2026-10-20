import { describe, expect, it } from 'vitest';
import { GoalError, goalMoneyOf, retagFits, type TradeRecord } from '../src/index';

const trade = (id: string, kind: TradeRecord['kind'], occurredOn: string, grossMinor: number, extra: Partial<TradeRecord> = {}): TradeRecord => ({
  id,
  accountId: 'fund',
  kind,
  occurredOn,
  createdAt: `${occurredOn}T00:00:00Z`,
  unitsMicro: 0,
  grossMinor,
  feeMinor: 0,
  taxMinor: 0,
  ...extra,
});

describe('goals in a fund tracked by money', () => {
  const trades = [
    trade('b1', 'buy', '2026-08-01', 600_000, { goalId: 'umroh' }),
    trade('b2', 'buy', '2026-08-02', 400_000, { goalId: 'house' }),
    trade('b3', 'buy', '2026-08-03', 500_000),
  ];

  it('counts each goal’s money put in, and the rest as untagged', () => {
    expect(goalMoneyOf(trades)).toEqual({ byGoal: { umroh: 600_000, house: 400_000, '': 500_000 }, costMinor: 1_500_000 });
  });

  it('takes a sell named to a goal out of that goal’s money alone', () => {
    const sold = [...trades, trade('s1', 'sell', '2026-09-01', 310_400, { goalId: 'umroh', basisMinor: 300_000 })];
    expect(goalMoneyOf(sold)).toEqual({ byGoal: { umroh: 300_000, house: 400_000, '': 500_000 }, costMinor: 1_200_000 });
  });

  it('refuses a sell that takes more out of a goal than it put in', () => {
    const over = [...trades, trade('s1', 'sell', '2026-09-01', 800_000, { goalId: 'house', basisMinor: 700_000 })];
    expect(() => goalMoneyOf(over)).toThrow(GoalError);
  });

  it('lets a buy move to another goal unless a later sell from its goal needs it', () => {
    expect(retagFits(trades, 'b1', 'house')).toBe(true);
    const sold = [...trades, trade('s1', 'sell', '2026-09-01', 600_000, { goalId: 'umroh', basisMinor: 500_000 })];
    expect(retagFits(sold, 'b1', 'house')).toBe(false);
  });
});
