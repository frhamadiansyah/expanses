import { describe, expect, it } from 'vitest';
import {
  addMonthsToDate,
  depositInterest,
  type DepositSchedule,
  dueDepositEvents,
  eventKey,
  needsPayout,
  termStart,
  withholdTax,
} from '../src/index';

describe('addMonthsToDate', () => {
  it('keeps the day of the month, forwards and back', () => {
    expect(addMonthsToDate('2026-07-15', 3)).toBe('2026-10-15');
    expect(addMonthsToDate('2026-10-15', -3)).toBe('2026-07-15');
  });

  it('lands on the last day when the month is shorter, counted from the anchor each time', () => {
    expect(addMonthsToDate('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonthsToDate('2027-01-31', 2)).toBe('2027-03-31');
    expect(addMonthsToDate('2028-01-31', 1)).toBe('2028-02-29');
  });

  it('wraps the year both ways', () => {
    expect(addMonthsToDate('2026-11-01', 3)).toBe('2027-02-01');
    expect(addMonthsToDate('2027-01-15', -1)).toBe('2026-12-15');
  });
});

describe('interest: actual/365, floored, in BigInt', () => {
  it('reproduces the mockup: Rp 50.000.000 at 4,25% for 92 days', () => {
    // 535 616,438… — 30/360 would give 531 250, actual/360 543 055.
    expect(depositInterest(50_000_000, 425, 92)).toBe(535_616);
  });

  it('floors rather than rounds', () => {
    // 174 657,53 — rounding would give 174 658.
    expect(depositInterest(50_000_000, 425, 30)).toBe(174_657);
    // US$10,000.00 in cents at 3,50% for 31 days: 2 972,60 — rounding gives 2 973; whole dollars give 2 900.
    expect(depositInterest(1_000_000, 350, 31)).toBe(2_972);
  });

  it('stays exact past 2^53', () => {
    // 1 000 000 000 020 × 1 000 × 365 = 3,650 000 000 073 × 10^17, past 2^53. The exact quotient is 100 000 000 002.
    // In floating point, Math.floor(p * r * d / 3_650_000) gives 100 000 000 001, so this fixture fails a float implementation.
    expect(depositInterest(1_000_000_000_020, 1_000, 365)).toBe(100_000_000_002);
  });

  it('counts the days a month really has (actual/365), not 30 a month (30/360)', () => {
    // 31 Jan → 28 Feb 2027 is 28 days. 50 000 000 × 425 × 28 / 3 650 000 = 163 013,698…
    // 30/360 counts 30 days and gives 177 083; rounding instead of flooring gives 163 014.
    const [february] = dueDepositEvents(
      { maturesOn: '2027-04-30', termMonths: 3, termStartedOn: '2027-01-31', interestPaid: 'monthly', enabledOn: '2027-01-31' },
      new Set(),
      '2027-02-28',
    );
    expect(february).toEqual({ kind: 'monthly', dueOn: '2027-02-28', periodFrom: '2027-01-31', days: 28 });
    expect(depositInterest(50_000_000, 425, february!.days)).toBe(163_013);
    // The quarter: 92 actual days give 535 616. 30/360 would count 90 days and give 531 250.
    expect(depositInterest(50_000_000, 425, dueDepositEvents(quarterly, new Set(), '2026-10-15')[0]!.days)).toBe(535_616);
  });

  it('is nothing without a principal, a rate or days', () => {
    expect(depositInterest(0, 425, 92)).toBe(0);
    expect(depositInterest(50_000_000, 0, 92)).toBe(0);
    expect(depositInterest(50_000_000, 425, 0)).toBe(0);
  });

  it('is nothing rather than negative or fractional: every guard, one at a time', () => {
    // A negative principal or day count would otherwise give negative interest; a fractional principal would throw
    // from BigInt(); a non-integer rate or day count is refused the same way.
    expect(depositInterest(-50_000_000, 425, 92)).toBe(0);
    expect(depositInterest(0.5, 425, 92)).toBe(0);
    expect(depositInterest(50_000_000, -425, 92)).toBe(0);
    expect(depositInterest(50_000_000, 425.5, 92)).toBe(0);
    expect(depositInterest(50_000_000, 425, -1)).toBe(0);
    expect(depositInterest(50_000_000, 425, 92.5)).toBe(0);
  });
});

describe('tax withheld', () => {
  it('floors the tax and subtracts it, so net + tax is gross exactly', () => {
    // 107 123,2 → 107 123; net 428 493. Flooring the net directly would give 428 492.
    expect(withholdTax(535_616, 2_000, false)).toEqual({ taxMinor: 107_123, netMinor: 428_493 });
    // 36 095,8 → 36 095 (rounding gives 36 096); net 144 384.
    expect(withholdTax(180_479, 2_000, false)).toEqual({ taxMinor: 36_095, netMinor: 144_384 });
  });

  it('takes nothing from a tax-free deposit, whatever the percentage says', () => {
    expect(withholdTax(19_109, 2_000, true)).toEqual({ taxMinor: 0, netMinor: 19_109 });
    // The same deposit taxed: 3 821,8 → 3 821 (rounding gives 3 822).
    expect(withholdTax(19_109, 2_000, false)).toEqual({ taxMinor: 3_821, netMinor: 15_288 });
  });

  it('follows the percentage the user typed', () => {
    // 12,5% of 180 479 = 22 559,875 → 22 559 (rounding gives 22 560; 20% would give 36 095). Net 157 920.
    expect(withholdTax(180_479, 1_250, false)).toEqual({ taxMinor: 22_559, netMinor: 157_920 });
  });

  it('is exact in integer arithmetic, where a float multiply would drift', () => {
    // 100 × 0,29 = 28,999999999999996 in float, which floors to 28. The exact answer, and the one BigInt gives, is 29.
    expect(withholdTax(100, 2_900, false)).toEqual({ taxMinor: 29, netMinor: 71 });
  });

  it('is nothing on a gross that is zero or negative, taxed or not', () => {
    expect(withholdTax(-5, 2_000, false)).toEqual({ taxMinor: 0, netMinor: -5 });
    expect(withholdTax(0, 2_000, false)).toEqual({ taxMinor: 0, netMinor: 0 });
  });
});

describe('where the money lands', () => {
  it('needs a payout account unless everything rolls over', () => {
    expect(needsPayout('principal')).toBe(true);
    expect(needsPayout('close')).toBe(true);
    expect(needsPayout('principal_interest')).toBe(false);
  });
});

const quarterly: DepositSchedule = {
  maturesOn: '2026-10-15',
  termMonths: 3,
  termStartedOn: null,
  interestPaid: 'at_maturity',
  enabledOn: '2026-07-15',
};
const monthly: DepositSchedule = { ...quarterly, interestPaid: 'monthly' };

describe('the current term', () => {
  it('is dated back from the maturity when no roll-over has dated it', () => {
    expect(termStart(quarterly)).toBe('2026-07-15');
  });

  it('uses the stored start only while it still agrees with the maturity', () => {
    expect(termStart({ ...quarterly, maturesOn: '2027-04-30', termStartedOn: '2027-01-31' })).toBe('2027-01-31');
    // Changed by hand on the terms card: the stored start no longer adds up, so it is derived again.
    expect(termStart({ ...quarterly, termStartedOn: '2026-04-15' })).toBe('2026-07-15');
  });
});

describe('what is due', () => {
  it('is one maturity over the whole term when interest is paid at maturity', () => {
    expect(dueDepositEvents(quarterly, new Set(), '2026-10-15')).toEqual([
      { kind: 'maturity', dueOn: '2026-10-15', periodFrom: '2026-07-15', days: 92 },
    ]);
  });

  it('is nothing the day before', () => {
    expect(dueDepositEvents(quarterly, new Set(), '2026-10-14')).toEqual([]);
  });

  it('is each monthly payout, then the maturity for the last month, in date order', () => {
    expect(dueDepositEvents(monthly, new Set(), '2026-10-15')).toEqual([
      { kind: 'monthly', dueOn: '2026-08-15', periodFrom: '2026-07-15', days: 31 },
      { kind: 'monthly', dueOn: '2026-09-15', periodFrom: '2026-08-15', days: 31 },
      { kind: 'maturity', dueOn: '2026-10-15', periodFrom: '2026-09-15', days: 30 },
    ]);
  });

  it('dates every payout from the start, not from the payout before', () => {
    const fromJan31: DepositSchedule = { ...monthly, maturesOn: '2027-04-30', termStartedOn: '2027-01-31' };
    expect(dueDepositEvents(fromJan31, new Set(), '2027-04-30').map((e) => [e.dueOn, e.days])).toEqual([
      ['2027-02-28', 28],
      ['2027-03-31', 31],
      ['2027-04-30', 30],
    ]);
  });

  it('leaves out what was confirmed', () => {
    const done = new Set([eventKey('monthly', '2026-08-15')]);
    expect(dueDepositEvents(monthly, done, '2026-10-15').map((e) => e.dueOn)).toEqual(['2026-09-15', '2026-10-15']);
  });

  it('skips monthly payouts from before the switch was turned on, but never a passed maturity', () => {
    expect(dueDepositEvents({ ...monthly, enabledOn: '2026-09-01' }, new Set(), '2026-10-15').map((e) => e.dueOn)).toEqual([
      '2026-09-15',
      '2026-10-15',
    ]);
    expect(dueDepositEvents({ ...monthly, enabledOn: '2026-12-01' }, new Set(), '2026-12-01').map((e) => e.kind)).toEqual(['maturity']);
  });

  it('includes a monthly payout due on the very day automation was switched on', () => {
    // Spec §4.3: dueOn ≥ enabledOn. A `>` in place of `>=` would drop this one, leaving only the maturity.
    expect(dueDepositEvents({ ...monthly, enabledOn: '2026-09-15' }, new Set(), '2026-09-15').map((e) => e.kind)).toEqual(['monthly']);
  });

  it('has only the maturity for a one-month deposit paying monthly', () => {
    const oneMonth: DepositSchedule = { ...monthly, termMonths: 1, maturesOn: '2026-08-15' };
    expect(dueDepositEvents(oneMonth, new Set(), '2026-08-15')).toEqual([
      { kind: 'maturity', dueOn: '2026-08-15', periodFrom: '2026-07-15', days: 31 },
    ]);
  });
});
