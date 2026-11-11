import { describe, expect, it } from 'vitest';
import {
  calculatorLoan,
  calculatorSchedule,
  effectiveYearlyCostBps,
  flatToEffectiveBps,
  halfRepaidMonth,
  type LoanCalcInput,
  loanSchedule,
  paymentJump,
  stageLines,
  yearlyRows,
} from '../src/index';

/** A house loan of 720.000.000 over 20 years: 5,5% fixed for 3 years, then 11% floating. Invented figures. */
const home: LoanCalcInput = {
  principalMinor: 720_000_000,
  method: 'annuity',
  stages: [
    { months: 36, rateBps: 550, kind: 'fixed' },
    { months: 204, rateBps: 1100, kind: 'floating' },
  ],
  firstPaymentOn: '2026-12-11',
  paymentDay: 11,
};

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

describe('the calculator loan', () => {
  it('turns stages into the terms and rate periods a saved loan carries, each period from its first payment', () => {
    const { terms, periods } = calculatorLoan(home);
    expect(terms).toEqual({ originalMinor: 720_000_000, firstPaymentOn: '2026-12-11', tenorMonths: 240, method: 'annuity', paymentDay: 11 });
    expect(periods).toEqual([
      { fromOn: '2026-12-11', rateBps: 550, kind: 'fixed', paymentMinor: 0 },
      { fromOn: '2029-12-11', rateBps: 1100, kind: 'floating', paymentMinor: 0 },
    ]);
  });

  it('is the loan engine’s own schedule, so a saved loan shows exactly these rows', () => {
    const { terms, periods } = calculatorLoan(home);
    expect(calculatorSchedule(home)).toEqual(loanSchedule(720_000_000, terms, periods, '2026-11-11'));
  });

  it('works an annuity out on what is owed, and recomputes it on what is left when a stage starts', () => {
    const rows = calculatorSchedule(home);
    expect(rows).toHaveLength(240);
    expect(rows[0]).toMatchObject({ onDate: '2026-12-11', paymentMinor: 4_952_789, interestMinor: 3_300_000, principalMinor: 1_652_789, balanceMinor: 718_347_211 });
    expect(rows[1]).toMatchObject({ interestMinor: 3_292_425, balanceMinor: 716_686_847 });
    expect(rows[36]!.onDate).toBe('2029-12-11');
    expect(rows[36]!.paymentMinor).toBeGreaterThan(rows[35]!.paymentMinor);
    // Every unit of the loan is repaid, and the last row leaves nothing.
    expect(sum(rows.map((row) => row.principalMinor))).toBe(720_000_000);
    expect(rows.at(-1)!.balanceMinor).toBe(0);
    for (const row of rows) expect(row.paymentMinor).toBe(row.principalMinor + row.interestMinor);
  });

  it('charges flat interest on the whole loan every month', () => {
    const rows = calculatorSchedule({ principalMinor: 262_500_000, method: 'flat', stages: [{ months: 48, rateBps: 450, kind: 'fixed' }], firstPaymentOn: '2026-12-11', paymentDay: 11 });
    expect(rows).toHaveLength(48);
    expect(rows[0]).toMatchObject({ paymentMinor: 6_453_125, interestMinor: 984_375, principalMinor: 5_468_750 });
    expect(rows.at(-1)!.interestMinor).toBe(984_375);
    expect(sum(rows.map((row) => row.paymentMinor))).toBe(309_750_000);
    expect(rows.at(-1)!.balanceMinor).toBe(0);
  });

  it('reads a rate a month as yearly basis points ×12, the stored convention', () => {
    // 2,95% a month is 3540 bps a year.
    const rows = calculatorSchedule({ principalMinor: 6_000_000, method: 'flat', stages: [{ months: 6, rateBps: 3540, kind: 'fixed' }], firstPaymentOn: '2026-12-11', paymentDay: 11 });
    expect(rows.map((row) => row.paymentMinor)).toEqual([1_177_000, 1_177_000, 1_177_000, 1_177_000, 1_177_000, 1_177_000]);
    expect(sum(rows.map((row) => row.interestMinor))).toBe(1_062_000);
  });

  it('shares a loan with no interest out evenly, the last month taking the rounding', () => {
    const rows = calculatorSchedule({ principalMinor: 1_000_000, method: 'zero', stages: [{ months: 3, rateBps: 0, kind: 'fixed' }], firstPaymentOn: '2026-12-11', paymentDay: 11 });
    expect(rows.map((row) => row.paymentMinor)).toEqual([333_333, 333_334, 333_333]);
    expect(sum(rows.map((row) => row.paymentMinor))).toBe(1_000_000);
    expect(rows.every((row) => row.interestMinor === 0)).toBe(true);
    expect(rows.at(-1)!.balanceMinor).toBe(0);
  });

  it('refuses a loan whose stages do not add up to whole months', () => {
    expect(() => calculatorLoan({ ...home, stages: [] })).toThrow();
    expect(() => calculatorLoan({ ...home, stages: [{ months: 0, rateBps: 550, kind: 'fixed' }] })).toThrow();
    expect(() => calculatorLoan({ ...home, principalMinor: 0 })).toThrow();
  });
});

describe('what the result page reads off the schedule', () => {
  const rows = calculatorSchedule(home);

  it('names each stage by its months and the payment it starts on', () => {
    const lines = stageLines(rows, home.stages);
    expect(lines).toEqual([
      { fromMonth: 1, toMonth: 36, rateBps: 550, kind: 'fixed', paymentMinor: 4_952_789 },
      { fromMonth: 37, toMonth: 240, rateBps: 1100, kind: 'floating', paymentMinor: rows[36]!.paymentMinor },
    ]);
  });

  it('finds the first stage that raises the payment, by how much and by what share', () => {
    const lines = stageLines(rows, home.stages);
    const jump = paymentJump(lines);
    expect(jump).not.toBeNull();
    expect(jump!.upMinor).toBe(lines[1]!.paymentMinor - lines[0]!.paymentMinor);
    expect(jump!.from).toBe(lines[0]);
    expect(jump!.to).toBe(lines[1]);
    // About 43,6% more a month.
    expect(Math.round(jump!.upBps / 10)).toBe(436);
    expect(paymentJump([lines[0]!])).toBeNull();
    expect(paymentJump([{ ...lines[1]!, paymentMinor: 9 }, { ...lines[0]!, paymentMinor: 5 }])).toBeNull();
  });

  it('says the month by which half of the loan is repaid', () => {
    expect(halfRepaidMonth(rows, 720_000_000)).toBe(172);
    expect(halfRepaidMonth([], 720_000_000)).toBeNull();
  });

  it('rolls the months up into years, the last year shorter when the months are not whole years', () => {
    const years = yearlyRows(rows);
    expect(years).toHaveLength(20);
    expect(years[0]).toEqual({
      index: 1,
      paymentMinor: sum(rows.slice(0, 12).map((row) => row.paymentMinor)),
      principalMinor: sum(rows.slice(0, 12).map((row) => row.principalMinor)),
      interestMinor: sum(rows.slice(0, 12).map((row) => row.interestMinor)),
      balanceMinor: rows[11]!.balanceMinor,
    });
    expect(years.at(-1)!.balanceMinor).toBe(0);
    expect(sum(years.map((year) => year.paymentMinor))).toBe(sum(rows.map((row) => row.paymentMinor)));
    const short = yearlyRows(rows.slice(0, 14));
    expect(short.map((year) => year.index)).toEqual([1, 2]);
    expect(short[1]!.paymentMinor).toBe(rows[12]!.paymentMinor + rows[13]!.paymentMinor);
  });
});

describe('the yearly cost of an online loan', () => {
  it('compounds the monthly rate that makes the payments worth what arrived after the fee', () => {
    // 6.000.000 at a flat 2,95% a month for 6 months, 180.000 taken at the start: 5.820.000 arrives.
    const bps = effectiveYearlyCostBps(5_820_000, Array(6).fill(1_177_000));
    expect(bps).toBeGreaterThan(9_600);
    expect(bps).toBeLessThan(9_900);
  });

  it('is nothing when nothing more than what arrived is paid back', () => {
    expect(effectiveYearlyCostBps(1_200_000, [400_000, 400_000, 400_000])).toBe(0);
  });

  it('is unknown for nothing borrowed or nothing paid', () => {
    expect(effectiveYearlyCostBps(0, [100])).toBeNull();
    expect(effectiveYearlyCostBps(100, [])).toBeNull();
  });

  it('agrees with the loan page’s flat-to-effective rate when there is no fee, before compounding', () => {
    // The loan page's figure is the nominal yearly one; the compounded one is a little higher.
    const nominal = flatToEffectiveBps(450, 48);
    const compounded = effectiveYearlyCostBps(262_500_000, Array(48).fill(6_453_125))!;
    expect(nominal).toBeGreaterThan(820);
    expect(nominal).toBeLessThan(850);
    expect(compounded).toBeGreaterThan(nominal);
  });
});
