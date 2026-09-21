import { describe, expect, it } from 'vitest';
import { checkOutflow, inflowTo, movedAmount, outflowFrom, setAsideOn, spreadOver, wholeSince } from '../src/index';

/*
 * The record's own account: Jenius holds Rp 42.500.000, Rp 30.000.000 of it is the Emergency fund (ranked first) and
 * Rp 7.500.000 is for Umrah (ranked second). Rp 5.000.000 is free.
 */
const EF = { goalId: 'ef', name: 'Emergency fund', rank: 0, promisedMinor: 30_000_000 };
const UMRAH = { goalId: 'umrah', name: 'Umrah 2027', rank: 1, promisedMinor: 7_500_000 };

describe('setAsideOn', () => {
  it('says what is free and leaves every goal covered while the balance holds', () => {
    const view = setAsideOn(42_500_000, [UMRAH, EF], []);
    expect(view).toMatchObject({ balanceMinor: 42_500_000, setAsideMinor: 37_500_000, freeMinor: 5_000_000, shortMinor: 0, state: 'covered' });
    // First-ranked first, whatever order the claims came in.
    expect(view.goals.map((goal) => [goal.goalId, goal.coveredMinor, goal.shortMinor])).toEqual([
      ['ef', 30_000_000, 0],
      ['umrah', 7_500_000, 0],
    ]);
  });

  it('shares a shortage out lowest priority first, and never counts the same money twice', () => {
    const view = setAsideOn(21_000_000, [EF, UMRAH], []);
    expect(view).toMatchObject({ freeMinor: -16_500_000, shortMinor: 16_500_000, state: 'short' });
    // Umrah carries all it can (Rp 7.500.000), the rest (Rp 9.000.000) falls on the Emergency fund.
    expect(view.goals.map((goal) => [goal.goalId, goal.coveredMinor, goal.shortMinor])).toEqual([
      ['ef', 21_000_000, 9_000_000],
      ['umrah', 0, 7_500_000],
    ]);
    // What the goals are counted as holding is exactly what the account holds. A per-goal cap at the balance
    // would count 21.000.000 + 7.500.000 = 28.500.000.
    expect(view.goals.reduce((total, goal) => total + goal.coveredMinor, 0)).toBe(21_000_000);
  });

  it('puts the shortage a borrow made on the goal borrowed from, even when it ranks first', () => {
    // A Rp 6.800.000 laptop with Rp 5.000.000 free: Rp 1.800.000 borrowed from the Emergency fund.
    const view = setAsideOn(35_700_000, [EF, UMRAH], [{ goalId: 'ef', amountMinor: 1_800_000, occurredOn: '2026-09-19', createdAt: '2026-09-19T08:00:00Z' }]);
    expect(view.goals.map((goal) => [goal.goalId, goal.shortMinor, goal.borrowedShortMinor])).toEqual([
      ['ef', 1_800_000, 1_800_000],
      ['umrah', 0, 0],
    ]);
  });

  it('lets a top-up shrink a borrowed shortfall with nothing written', () => {
    const borrow = { goalId: 'ef', amountMinor: 1_800_000, occurredOn: '2026-09-19', createdAt: '2026-09-19T08:00:00Z' };
    expect(setAsideOn(36_700_000, [EF, UMRAH], [borrow]).goals[0]).toMatchObject({ shortMinor: 800_000, coveredMinor: 29_200_000 });
    expect(setAsideOn(37_500_000, [EF, UMRAH], [borrow])).toMatchObject({ state: 'covered', shortMinor: 0 });
  });

  it('caps what a borrow explains at what was borrowed, and lets the rest fall by rank', () => {
    const borrow = { goalId: 'ef', amountMinor: 1_800_000, occurredOn: '2026-09-19', createdAt: '2026-09-19T08:00:00Z' };
    // Rp 20.000.000 more left afterwards, unasked (the account was already short).
    const view = setAsideOn(15_700_000, [EF, UMRAH], [borrow]);
    // 21.800.000 short: 1.800.000 on EF for its borrow, then Umrah takes 7.500.000, then EF the last 12.500.000.
    expect(view.goals.map((goal) => [goal.goalId, goal.shortMinor, goal.borrowedShortMinor])).toEqual([
      ['ef', 14_300_000, 1_800_000],
      ['umrah', 7_500_000, 0],
    ]);
  });

  it('takes the most recent borrow first when two goals borrowed', () => {
    const view = setAsideOn(36_500_000, [EF, UMRAH], [
      { goalId: 'ef', amountMinor: 600_000, occurredOn: '2026-09-01', createdAt: '2026-09-01T08:00:00Z' },
      { goalId: 'umrah', amountMinor: 700_000, occurredOn: '2026-09-02', createdAt: '2026-09-02T08:00:00Z' },
    ]);
    // Rp 1.000.000 short: Umrah (latest) carries its 700.000, EF the remaining 300.000.
    expect(view.goals.map((goal) => [goal.goalId, goal.shortMinor])).toEqual([
      ['ef', 300_000],
      ['umrah', 700_000],
    ]);
  });

  it('treats an overdrawn account as holding nothing, and keeps free signed', () => {
    const view = setAsideOn(-1_000_000, [UMRAH], []);
    expect(view).toMatchObject({ freeMinor: -8_500_000, shortMinor: 7_500_000 });
  });

  it('works in the account\'s own minor units', () => {
    // US$110,03 held, US$100,03 promised: US$10,00 free, in cents.
    expect(setAsideOn(11_003, [{ goalId: 'edu', name: 'Education', rank: 0, promisedMinor: 10_003 }], [])).toMatchObject({ freeMinor: 1_000 });
  });

  it('says none when nothing is promised', () => {
    expect(setAsideOn(5_000_000, [], [])).toMatchObject({ state: 'none', setAsideMinor: 0, freeMinor: 5_000_000 });
  });
});

describe('checkOutflow', () => {
  const jenius = setAsideOn(42_500_000, [EF, UMRAH], []);

  it('is silent within what is free, to the rupiah', () => {
    expect(checkOutflow(jenius, 3_000_000)).toEqual({ kind: 'silent' });
    expect(checkOutflow(jenius, 5_000_000)).toEqual({ kind: 'silent' });
  });

  it('asks the moment it takes one more than is free', () => {
    const check = checkOutflow(jenius, 5_000_001);
    expect(check).toMatchObject({ kind: 'ask', overMinor: 1, freeMinor: 5_000_000 });
  });

  it('asks about the laptop, and lists the goals it could come from, first-ranked first', () => {
    const check = checkOutflow(jenius, 6_800_000);
    if (check.kind !== 'ask') throw new Error(`expected ask, got ${check.kind}`);
    expect(check.overMinor).toBe(1_800_000);
    expect(check.goals.map((goal) => [goal.goalId, goal.coveredMinor])).toEqual([
      ['ef', 30_000_000],
      ['umrah', 7_500_000],
    ]);
  });

  it('never speaks for an account with nothing promised, or when nothing leaves', () => {
    expect(checkOutflow(setAsideOn(1_000_000, [], []), 50_000_000)).toEqual({ kind: 'silent' });
    expect(checkOutflow(jenius, 0)).toEqual({ kind: 'silent' });
  });

  it('does not re-ask on an account that is already short', () => {
    expect(checkOutflow(setAsideOn(21_000_000, [EF, UMRAH], []), 100_000)).toEqual({ kind: 'already-short', shortMinor: 16_500_000 });
  });

  it('asks on an account with exactly nothing free', () => {
    expect(checkOutflow(setAsideOn(37_500_000, [EF, UMRAH], []), 1)).toMatchObject({ kind: 'ask', overMinor: 1, freeMinor: 0 });
  });

  it('lets a movement for a goal use that goal\'s own money first, and offers only the others', () => {
    // Umrah's own Rp 7.500.000 plus Rp 5.000.000 free: Rp 12.500.000 goes without a word.
    expect(checkOutflow(jenius, 12_500_000, 'umrah')).toEqual({ kind: 'silent' });
    const check = checkOutflow(jenius, 13_000_000, 'umrah');
    if (check.kind !== 'ask') throw new Error(`expected ask, got ${check.kind}`);
    expect(check.overMinor).toBe(500_000);
    expect(check.goals.map((goal) => goal.goalId)).toEqual(['ef']);
  });

  it('stays silent when there is no other goal it could come from', () => {
    const umrahOnly = setAsideOn(10_000_000, [UMRAH], []);
    expect(checkOutflow(umrahOnly, 11_000_000, 'umrah')).toEqual({ kind: 'silent' });
  });
});

describe('outflowFrom and inflowTo', () => {
  it('sums the signed lines on the account and clamps after, never before', () => {
    const lines = [
      { accountId: 'jenius', amountMinor: 5 },
      { accountId: 'jenius', amountMinor: -8 },
      { accountId: 'food', amountMinor: 3 },
    ];
    // −8 + 5 = −3 left the account. A per-line absolute value would say 13, or 8.
    expect(outflowFrom(lines, 'jenius')).toBe(3);
    expect(inflowTo(lines, 'jenius')).toBe(0);
    expect(inflowTo(lines, 'food')).toBe(3);
    expect(outflowFrom(lines, 'food')).toBe(0);
    expect(outflowFrom(lines, 'bca')).toBe(0);
  });
});

describe('movedAmount', () => {
  it('floors, never rounds', () => {
    // Rp 1.800.000 of a Rp 20.000.000 transfer that landed as US$1.234,63: 11.111,67 cents → 11.111.
    expect(movedAmount(1_800_000, 20_000_000, 123_463)).toBe(11_111);
  });

  it('stays exact where a double would round the product', () => {
    // The product is ~4,98e22, past 2^53. Float arithmetic gives 7.837.466.464; the exact floor is …463.
    expect(movedAmount(6_356_184_760_608, 6_356_184_761_419, 7_837_466_465)).toBe(7_837_466_463);
  });

  it('is nought when nothing moved or nothing landed', () => {
    expect(movedAmount(0, 20_000_000, 123_463)).toBe(0);
    expect(movedAmount(1_800_000, 20_000_000, 0)).toBe(0);
  });
});

describe('spreadOver', () => {
  it('gives the overage to the payment that crosses what is free, and all of every later one', () => {
    // Rp 5.000.000 free; three bills of 3, 4 and 2 million. Cumulative 3, 7, 9: over 0, 2, 2.
    expect(spreadOver([3_000_000, 4_000_000, 2_000_000], 5_000_000)).toEqual([0, 2_000_000, 2_000_000]);
    expect(spreadOver([7_000_000], 5_000_000)).toEqual([2_000_000]);
    expect(spreadOver([3_000_000], 5_000_000)).toEqual([0]);
    expect(spreadOver([1_000, 2_000], 0)).toEqual([1_000, 2_000]);
  });
});

describe('wholeSince', () => {
  const events = [
    { occurredOn: '2026-02-04', amountMinor: 24_000_000 },
    { occurredOn: '2026-08-03', amountMinor: 6_000_000 },
    { occurredOn: '2026-09-01', amountMinor: 1_000_000 },
  ];

  it('is the day the set-aside last rose to the target, not the first or the latest change', () => {
    expect(wholeSince(events, 31_000_000, 30_000_000, null)).toBe('2026-08-03');
  });

  it('is null for a goal that is not whole', () => {
    expect(wholeSince(events, 29_000_000, 30_000_000, null)).toBeNull();
    expect(wholeSince(events, 1_000, 0, null)).toBeNull();
  });

  it('is null when the records run out while it is still whole', () => {
    expect(wholeSince([{ occurredOn: '2026-09-01', amountMinor: 1_000_000 }], 31_000_000, 30_000_000, null)).toBeNull();
  });

  it('stops at an earlier borrow, whose repayment date is not recorded', () => {
    expect(wholeSince(events, 31_000_000, 30_000_000, '2026-08-10')).toBeNull();
    expect(wholeSince(events, 31_000_000, 30_000_000, '2026-08-03')).toBe('2026-08-03');
  });
});
