import { describe, expect, it } from 'vitest';
import { GoalError, goalUnitsFor, goalUnitsOf, positionAfter, type TradeRecord, UNTAGGED } from '../src/index';

let seq = 0;
function trade(partial: Partial<TradeRecord> & Pick<TradeRecord, 'kind' | 'occurredOn'>): TradeRecord {
  seq += 1;
  return {
    id: `t${seq}`,
    accountId: 'gold',
    createdAt: `2026-01-01T00:00:${String(seq).padStart(2, '0')}Z`,
    unitsMicro: 0,
    grossMinor: 0,
    feeMinor: 0,
    taxMinor: 0,
    ...partial,
  };
}
const buy = (occurredOn: string, grams: number, goalId: string | null, extra: Partial<TradeRecord> = {}) =>
  trade({ kind: 'buy', occurredOn, unitsMicro: grams * 1_000_000, grossMinor: grams * 1_800_000, goalId, ...extra });
const sell = (occurredOn: string, grams: number, goalId: string | null) =>
  trade({ kind: 'sell', occurredOn, unitsMicro: grams * 1_000_000, grossMinor: grams * 1_900_000, goalId });

describe('goalUnitsOf', () => {
  it('puts a buy under the goal it names', () => {
    const units = goalUnitsOf([buy('2026-03-09', 5, 'hajj')]);
    expect(units.byGoal).toEqual({ hajj: 5_000_000 });
    expect(units.unitsMicro).toBe(5_000_000);
  });

  it('puts an untagged buy under the empty key', () => {
    const units = goalUnitsOf([buy('2026-03-09', 5, null)]);
    expect(units.byGoal).toEqual({ [UNTAGGED]: 5_000_000 });
  });

  it('lets one holding fund two goals', () => {
    const units = goalUnitsOf([buy('2026-08-09', 1, 'edu'), buy('2026-09-09', 2, 'hajj'), buy('2024-02-03', 10, 'hajj')]);
    expect(units.byGoal).toEqual({ hajj: 12_000_000, edu: 1_000_000 });
    expect(units.unitsMicro).toBe(13_000_000);
  });

  it('takes a sell from its own goal only', () => {
    const units = goalUnitsOf([buy('2024-02-03', 10, 'hajj'), buy('2026-08-09', 4, 'edu'), sell('2026-09-10', 3, 'edu')]);
    expect(units.byGoal).toEqual({ hajj: 10_000_000, edu: 1_000_000 });
  });

  it('refuses to sell more than the goal holds, and says how much it holds', () => {
    const trades = [buy('2024-02-03', 10, 'hajj'), buy('2026-08-09', 1, 'edu'), sell('2026-09-10', 2, 'edu')];
    expect(() => goalUnitsOf(trades)).toThrow(GoalError);
    expect(() => goalUnitsOf(trades)).toThrow(/1/);
  });

  it('leaves tagged goals alone when untagged units are sold', () => {
    const units = goalUnitsOf([buy('2024-02-03', 10, 'hajj'), buy('2026-08-09', 4, null), sell('2026-09-10', 4, null)]);
    expect(units.byGoal).toEqual({ hajj: 10_000_000 });
  });

  it('scales every goal in proportion on a unit change', () => {
    const units = goalUnitsOf([
      buy('2025-05-19', 2000, 'retire'),
      buy('2025-05-20', 1000, 'edu'),
      trade({ kind: 'unit_change', occurredOn: '2026-05-02', unitsMicro: 12_000 * 1_000_000 }),
    ]);
    expect(units.unitsMicro).toBe(15_000_000_000);
    expect(units.byGoal['retire']).toBe(10_000_000_000);
    expect(units.byGoal['edu']).toBe(5_000_000_000);
  });

  it('drops a goal once its units are gone', () => {
    const units = goalUnitsOf([buy('2026-08-09', 4, 'edu'), sell('2026-09-10', 4, 'edu')]);
    expect(units.byGoal).toEqual({});
    expect(units.unitsMicro).toBe(0);
  });

  it('ignores income, which moves no units', () => {
    const units = goalUnitsOf([buy('2026-08-09', 4, 'edu'), trade({ kind: 'income', occurredOn: '2026-09-01', grossMinor: 540_000 })]);
    expect(units.byGoal).toEqual({ edu: 4_000_000 });
  });

  it('stops at upTo', () => {
    const units = goalUnitsOf([buy('2024-02-03', 10, 'hajj'), buy('2026-09-09', 2, 'hajj')], '2026-01-01');
    expect(units.byGoal).toEqual({ hajj: 10_000_000 });
  });

  it('adds up to the units the position holds', () => {
    const trades = [buy('2024-02-03', 10, 'hajj'), buy('2026-08-09', 1, 'edu'), sell('2026-09-10', 4, 'hajj')];
    const units = goalUnitsOf(trades);
    const summed = Object.values(units.byGoal).reduce((total, value) => total + value, 0);
    expect(summed).toBe(positionAfter(trades).unitsMicro);
  });
});

describe('goalUnitsFor', () => {
  it('groups holdings by account', () => {
    const trades = [buy('2024-02-03', 10, 'hajj'), buy('2026-06-12', 3, 'edu', { accountId: 'fund' })];
    const byAccount = goalUnitsFor(trades);
    expect(Object.keys(byAccount).sort()).toEqual(['fund', 'gold']);
    expect(byAccount['gold']!.byGoal).toEqual({ hajj: 10_000_000 });
    expect(byAccount['fund']!.byGoal).toEqual({ edu: 3_000_000 });
  });

  it('returns nothing for no trades', () => {
    expect(goalUnitsFor([])).toEqual({});
  });
});
