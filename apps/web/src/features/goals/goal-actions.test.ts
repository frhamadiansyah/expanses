import { describe, expect, it } from 'vitest';
import { leftForGoal, lowered, monthlyAfter, monthlyPrefill, movablePurchases, moved, purchaseShare, setAsideFirst, setAsideOf, setAsideOn } from './goal-actions';

describe('lowering a set-aside (Use, Take back)', () => {
  it('takes what is asked and leaves the rest', () => {
    expect(lowered(7_500_000, 2_000_000)).toEqual({ takenMinor: 2_000_000, leftMinor: 5_500_000 });
  });

  it('never takes more than is set aside, and never leaves less than nought', () => {
    expect(lowered(7_500_000, 9_000_000)).toEqual({ takenMinor: 7_500_000, leftMinor: 0 });
  });

  it('takes nothing for an empty, nought or negative figure', () => {
    expect(lowered(7_500_000, null)).toEqual({ takenMinor: 0, leftMinor: 7_500_000 });
    expect(lowered(7_500_000, 0)).toEqual({ takenMinor: 0, leftMinor: 7_500_000 });
    expect(lowered(7_500_000, -5)).toEqual({ takenMinor: 0, leftMinor: 7_500_000 });
    expect(lowered(7_500_000, Number.NaN)).toEqual({ takenMinor: 0, leftMinor: 7_500_000 });
  });
});

describe('moving a set-aside to another goal', () => {
  it('lowers one side and raises the other by the same figure', () => {
    expect(moved(7_500_000, 1_000_000, 2_500_000)).toEqual({ movedMinor: 2_500_000, sourceLeftMinor: 5_000_000, targetAfterMinor: 3_500_000 });
  });

  it('never moves more than the source holds', () => {
    expect(moved(7_500_000, 0, 10_000_000)).toEqual({ movedMinor: 7_500_000, sourceLeftMinor: 0, targetAfterMinor: 7_500_000 });
  });
});

describe('which accounts hold money for the goal', () => {
  const earmarks = [
    { goalId: 'umrah', accountId: 'jenius', amountMinor: 7_500_000 },
    { goalId: 'ef', accountId: 'bca', amountMinor: 30_000_000 },
    { goalId: 'umrah', accountId: 'wise', amountMinor: 0 },
  ];

  it('lists only the set-asides holding something', () => {
    expect(setAsideOf(earmarks, 'umrah')).toEqual([earmarks[0]]);
    expect(setAsideOn(earmarks, 'umrah', 'jenius')).toBe(7_500_000);
    expect(setAsideOn(earmarks, 'umrah', 'bca')).toBe(0);
  });

  it('puts them first, keeping the order of the rest', () => {
    const accounts = [{ id: 'bca' }, { id: 'cash' }, { id: 'jenius' }];
    expect(setAsideFirst(accounts, earmarks, 'umrah').map((account) => account.id)).toEqual(['jenius', 'bca', 'cash']);
  });
});

describe('what is left for the goal', () => {
  const accounts = [
    { accountId: 'jenius', currency: 'IDR', amountMinor: 7_500_000 },
    { accountId: 'bca', currency: 'IDR', amountMinor: 2_500_000 },
    { accountId: 'wise', currency: 'USD', amountMinor: 10_000 },
  ];

  it('adds each currency on its own, less what one account gave up', () => {
    expect(leftForGoal(accounts, 'jenius', 2_000_000)).toEqual([
      { currency: 'IDR', amountMinor: 8_000_000 },
      { currency: 'USD', amountMinor: 10_000 },
    ]);
  });

  it('never counts an account below nought', () => {
    expect(leftForGoal(accounts.slice(0, 1), 'jenius', 9_000_000)).toEqual([{ currency: 'IDR', amountMinor: 0 }]);
  });
});

describe('the monthly amount', () => {
  it('opens on what is needed when nothing is set up', () => {
    expect(monthlyPrefill(1_250_000, 0, 0)).toBe(1_250_000);
  });

  it('opens on the standing amount once something is set up', () => {
    expect(monthlyPrefill(1_250_000, 800_000, 500_000)).toBe(500_000);
  });

  it('swaps only the standing part, keeping monthly buys, and reads the status off the result', () => {
    // 300.000 a month of buys plus 500.000 standing; 1.000.000 needed.
    expect(monthlyAfter(1_000_000, 800_000, 500_000, 700_000)).toEqual({ plannedMonthlyMinor: 1_000_000, status: 'on_track' });
    expect(monthlyAfter(1_000_000, 800_000, 500_000, 100_000)).toEqual({ plannedMonthlyMinor: 400_000, status: 'behind' });
    expect(monthlyAfter(0, 0, 0, null)).toEqual({ plannedMonthlyMinor: 0, status: 'funded' });
  });
});

describe('what a tagged purchase is worth to the goal', () => {
  it('is its share of the units the goal holds there', () => {
    expect(purchaseShare(5_000_000, 10_000_000, 18_000_000)).toBe(9_000_000);
  });

  it('is never more than everything the goal holds there, and nothing without units', () => {
    expect(purchaseShare(12_000_000, 10_000_000, 18_000_000)).toBe(18_000_000);
    expect(purchaseShare(5_000_000, 0, 18_000_000)).toBe(0);
  });
});

describe('the purchases Move offers', () => {
  const trade = (id: string, kind: 'buy' | 'sell', grams: number, goalId: string | null, extra: { accountId?: string; occurredOn?: string; status?: string } = {}) => ({
    id,
    accountId: extra.accountId ?? 'gold',
    kind,
    occurredOn: extra.occurredOn ?? '2026-03-09',
    createdAt: `2026-01-01T00:00:0${id.length}Z`,
    unitsMicro: grams * 1_000_000,
    grossMinor: 0,
    feeMinor: 0,
    taxMinor: 0,
    goalId,
    status: extra.status ?? 'active',
  });

  it('offers the goal’s own buys and nothing else', () => {
    const trades = [trade('a', 'buy', 5, 'umrah'), trade('b', 'buy', 2, 'holiday'), trade('c', 'buy', 1, null), trade('d', 'buy', 1, 'umrah', { status: 'replaced' })];
    expect(movablePurchases(trades, 'umrah').map((row) => row.id)).toEqual(['a']);
  });

  it('leaves out a buy whose units were sold from the goal', () => {
    const trades = [trade('a', 'buy', 10, 'umrah'), trade('s', 'sell', 3, 'umrah', { occurredOn: '2026-04-01' })];
    expect(movablePurchases(trades, 'umrah')).toEqual([]);
  });

  it('still offers a buy the goal can spare, and reads each holding on its own', () => {
    const trades = [
      trade('a', 'buy', 10, 'umrah'),
      trade('bb', 'buy', 2, 'umrah'),
      trade('s', 'sell', 3, 'umrah', { occurredOn: '2026-04-01' }),
      trade('x', 'buy', 1, 'umrah', { accountId: 'bbri' }),
    ];
    expect(movablePurchases(trades, 'umrah').map((row) => row.id)).toEqual(['bb', 'x']);
  });
});
