import { describe, expect, it } from 'vitest';
import { annuityPaymentMinor, type LoanTerms, loanSchedule, type RatePeriod, type ScheduleRow } from '../src/index';

/** A KPR of Rp 700.000.000 over 15 years at 9%, paid on the 25th. */
const kpr: LoanTerms = {
  originalMinor: 700_000_000,
  firstPaymentOn: '2026-01-25',
  tenorMonths: 180,
  method: 'annuity',
  paymentDay: 25,
};

const fixed = (rateBps: number, fromOn = '2026-01-25', paymentMinor = 0): RatePeriod => ({ fromOn, rateBps, kind: 'fixed', paymentMinor });

const totalOf = (rows: ScheduleRow[], key: 'principalMinor' | 'interestMinor') => rows.reduce((sum, row) => sum + row[key], 0);

describe('an annuity loan', () => {
  const rows = loanSchedule(700_000_000, kpr, [fixed(900)], '2026-01-01');

  it('runs for the months still left', () => {
    expect(rows).toHaveLength(180);
  });

  it('charges interest on what is still owed, so the balance falls faster each month', () => {
    expect(rows[0]!.interestMinor).toBeGreaterThan(rows[1]!.interestMinor);
    expect(rows[0]!.principalMinor).toBeLessThan(rows[1]!.principalMinor);
  });

  it('pays the same amount every month, give or take a rupiah of rounding', () => {
    const middle = rows.slice(1, -1).map((row) => row.paymentMinor);
    expect(Math.max(...middle) - Math.min(...middle)).toBeLessThanOrEqual(1);
  });

  it('clears the balance exactly, leaving nothing owing', () => {
    expect(rows.at(-1)!.balanceMinor).toBe(0);
    expect(totalOf(rows, 'principalMinor')).toBe(700_000_000);
  });

  it('gives every row a payment that is its principal plus its interest', () => {
    for (const row of rows) expect(row.paymentMinor).toBe(row.principalMinor + row.interestMinor);
  });

  it('falls due on the payment day, every month, February included', () => {
    expect(rows[0]!.onDate).toBe('2026-01-25');
    expect(rows[1]!.onDate).toBe('2026-02-25');
    expect(rows[2]!.onDate).toBe('2026-03-25');
  });

  it('starts from what the ledger says is left, not from the original amount', () => {
    const part = loanSchedule(400_000_000, kpr, [fixed(900)], '2026-01-01');
    expect(part[0]!.balanceMinor).toBeLessThan(400_000_000);
    expect(totalOf(part, 'principalMinor')).toBe(400_000_000);
  });
});

describe('a flat-rate loan', () => {
  // Rp 60.000.000 over 12 months at a flat 5%: interest is Rp 250.000 every month.
  const terms: LoanTerms = { originalMinor: 60_000_000, firstPaymentOn: '2026-02-10', tenorMonths: 12, method: 'flat', paymentDay: 10 };
  const rows = loanSchedule(60_000_000, terms, [fixed(500, '2026-02-10')], '2026-02-01');

  it('charges the same interest every month, worked out on the original', () => {
    expect(new Set(rows.map((row) => row.interestMinor)).size).toBe(1);
    expect(rows[0]!.interestMinor).toBe(250_000);
  });

  it('repays the principal in equal parts', () => {
    expect(rows[0]!.principalMinor).toBe(5_000_000);
    expect(totalOf(rows, 'principalMinor')).toBe(60_000_000);
  });

  it('ends at zero', () => {
    expect(rows.at(-1)!.balanceMinor).toBe(0);
  });
});

describe('a zero-rate loan', () => {
  const terms: LoanTerms = { originalMinor: 12_000_000, firstPaymentOn: '2026-03-05', tenorMonths: 6, method: 'zero', paymentDay: 5 };
  const rows = loanSchedule(12_000_000, terms, [fixed(0, '2026-03-05')], '2026-03-01');

  it('is principal and nothing else', () => {
    expect(totalOf(rows, 'interestMinor')).toBe(0);
    expect(rows[0]!.paymentMinor).toBe(2_000_000);
    expect(rows.at(-1)!.balanceMinor).toBe(0);
  });
});

describe('rate periods', () => {
  it('changes the payment from the month the new rate starts', () => {
    const rows = loanSchedule(700_000_000, kpr, [fixed(700), fixed(1100, '2029-01-25')], '2026-01-01');
    const before = rows.find((row) => row.onDate === '2028-12-25')!;
    const after = rows.find((row) => row.onDate === '2029-01-25')!;

    expect(after.paymentMinor).toBeGreaterThan(before.paymentMinor);
    expect(rows.at(-1)!.balanceMinor).toBe(0);
  });

  it('keeps the payment the bank asks for when it names one', () => {
    const rows = loanSchedule(700_000_000, kpr, [{ fromOn: '2026-01-25', rateBps: 900, kind: 'floating', paymentMinor: 7_500_000 }], '2026-01-01');

    expect(rows[0]!.paymentMinor).toBe(7_500_000);
  });

  it('leaves the months before the change alone', () => {
    const one = loanSchedule(700_000_000, kpr, [fixed(700)], '2026-01-01');
    const two = loanSchedule(700_000_000, kpr, [fixed(700), fixed(1100, '2029-01-25')], '2026-01-01');

    expect(two[0]).toEqual(one[0]);
    expect(two[11]).toEqual(one[11]);
  });
});

describe('edge cases', () => {
  it('has no rows when nothing is owed', () => {
    expect(loanSchedule(0, kpr, [fixed(900)], '2026-01-01')).toEqual([]);
  });

  it('has no rows once the tenor has run out', () => {
    // The last payment falls on 2040-12-25, so nothing is scheduled after it.
    expect(loanSchedule(5_000_000, kpr, [fixed(900)], '2041-06-01')).toEqual([]);
  });

  it('clears a last small balance over the payments that are left', () => {
    const rows = loanSchedule(1_200_000, kpr, [fixed(900)], '2040-10-01');
    expect(rows.at(-1)!.balanceMinor).toBe(0);
    expect(totalOf(rows, 'principalMinor')).toBe(1_200_000);
  });
});

describe('annuityPaymentMinor', () => {
  it('works out the level payment that clears a balance', () => {
    // Rp 700.000.000 at 9% over 180 months is about Rp 7.099.000 a month.
    const payment = annuityPaymentMinor(700_000_000, 900, 180);
    expect(payment).toBeGreaterThan(7_000_000);
    expect(payment).toBeLessThan(7_200_000);
  });

  it('splits the balance evenly when there is no interest', () => {
    expect(annuityPaymentMinor(12_000_000, 0, 6)).toBe(2_000_000);
  });

  it('is the whole balance over a single month', () => {
    expect(annuityPaymentMinor(1_000_000, 0, 1)).toBe(1_000_000);
  });
});
