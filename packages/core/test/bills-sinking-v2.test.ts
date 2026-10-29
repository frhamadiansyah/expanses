import { describe, expect, it } from 'vitest';
import {
  monthlyAt,
  monthsBetween,
  recalcMonthly,
  type SinkingEntry,
  type SinkingFundFacts,
  sinkingExtraPreview,
  sinkingHistory,
  sinkingPlan,
  sinkingProgress,
  sinkingRecalc,
  sinkingSavePlan,
  withPlan,
} from '../src/index';

const extra = (amountMinor: number, occurredOn: string, id = `x-${occurredOn}`): SinkingEntry => ({ id, kind: 'extra', month: null, amountMinor, occurredOn });
const opening = (amountMinor: number, occurredOn = '2026-03-10'): SinkingEntry => ({ id: 'opening', kind: 'opening', month: null, amountMinor, occurredOn });
const skip = (month: string): SinkingEntry => ({ id: `skip-${month}`, kind: 'skip', month, amountMinor: 0, occurredOn: `${month}-15` });
const plan = (month: string, amountMinor: number): SinkingEntry => ({ id: `plan-${month}`, kind: 'plan', month, amountMinor, occurredOn: `${month}-15` });

describe('what is set aside over time', () => {
  const fund: SinkingFundFacts = { monthlyMinor: 468_750, startedMonth: '2026-03', entries: [] };
  const target = 3_750_000;
  it('counts the month it starts in, then one more each month', () => {
    expect(sinkingProgress(fund, target, '2026-11', '2026-03-10')).toMatchObject({ savedMinor: 468_750, monthsDone: 1, monthsTotal: 8 });
    expect(sinkingProgress(fund, target, '2026-11', '2026-05-31').savedMinor).toBe(3 * 468_750);
  });
  it('never goes above the target', () => {
    expect(sinkingProgress(fund, target, '2026-11', '2026-11-01')).toMatchObject({ savedMinor: 3_750_000, monthsDone: 8 });
    expect(sinkingProgress(fund, target, '2026-11', '2027-06-01')).toMatchObject({ savedMinor: 3_750_000, monthsDone: 8 });
  });
  it('nothing before the month it starts', () => {
    expect(sinkingProgress(fund, target, '2026-11', '2026-02-28').savedMinor).toBe(0);
  });
  it('already saved and extra money add to it, still capped', () => {
    expect(sinkingProgress({ ...fund, entries: [opening(1_000_000)] }, target, '2026-11', '2026-04-01').savedMinor).toBe(2 * 468_750 + 1_000_000);
    expect(sinkingProgress({ ...fund, entries: [extra(1_000_000, '2026-04-01')] }, target, '2026-11', '2026-04-01').savedMinor).toBe(2 * 468_750 + 1_000_000);
    expect(sinkingProgress({ ...fund, entries: [extra(9_000_000, '2026-04-01')] }, target, '2026-11', '2026-04-01')).toMatchObject({ savedMinor: target, rawMinor: 9_937_500 });
  });
  it('a skipped month adds nothing, and without the skip it is back', () => {
    const skipped = { ...fund, entries: [skip('2026-04')] };
    expect(sinkingProgress(skipped, target, '2026-11', '2026-05-31').savedMinor).toBe(2 * 468_750);
    expect(sinkingProgress(skipped, target, '2026-11', '2026-05-31').months.map((m) => m.skipped)).toEqual([false, true, false]);
    expect(sinkingProgress(fund, target, '2026-11', '2026-05-31').savedMinor).toBe(3 * 468_750);
  });
  it('a new monthly figure counts only from its month on; earlier months keep what they added', () => {
    const changed = { ...fund, entries: [plan('2026-05', 100_000)] };
    expect(sinkingProgress(changed, target, '2026-11', '2026-04-30').savedMinor).toBe(2 * 468_750);
    expect(sinkingProgress(changed, target, '2026-11', '2026-06-30')).toMatchObject({ savedMinor: 2 * 468_750 + 2 * 100_000, monthlyMinor: 100_000 });
    expect(monthlyAt({ ...fund, entries: [plan('2026-07', 5), plan('2026-05', 100_000)] }, '2026-06')).toBe(100_000);
    expect(monthlyAt({ ...fund, entries: [plan('2026-07', 5), plan('2026-05', 100_000)] }, '2026-09')).toBe(5);
    expect(monthlyAt(fund, '2026-09')).toBe(468_750);
  });
  it('months between', () => {
    expect(monthsBetween('2026-11', '2027-02')).toBe(3);
    expect(monthsBetween('2027-02', '2026-11')).toBe(-3);
  });
});

describe("the owner's example: Rp 612.385 set up in October for April", () => {
  const target = 612_385;
  const due = '2027-04';
  const base: SinkingFundFacts = { monthlyMinor: 102_065, startedMonth: '2026-10', entries: [] };
  it('starts at 6 months of 102.065 (612.385 / 6 = 102.064,17 rounded up to the rupiah)', () => {
    expect(sinkingPlan({ targetMinor: target, today: '2026-10-10', repeatMonth: 4, dayOfMonth: 10, currency: 'IDR' })).toEqual({ dueMonth: due, monthsLeft: 6, monthlyMinor: 102_065 });
  });
  it('skipping November: 510.320 over the 4 months December to March = 127.580', () => {
    const skipped: SinkingFundFacts = { ...base, entries: [skip('2026-11')] };
    expect(sinkingProgress(skipped, target, due, '2026-11-05').rawMinor).toBe(102_065);
    expect(sinkingRecalc(skipped, target, due, '2026-11-05', 'IDR')).toEqual({ monthlyMinor: 127_580, monthsLeft: 4, effectiveFrom: '2026-12' });
  });
  it('the new figure applies from December, so the months already counted do not move', () => {
    const afterSkip = withPlan({ ...base, entries: [skip('2026-11')] }, '2026-12', 127_580);
    expect(sinkingProgress(afterSkip, target, due, '2026-11-30')).toMatchObject({ savedMinor: 102_065, monthlyMinor: 127_580 });
    expect(sinkingProgress(afterSkip, target, due, '2026-12-01').savedMinor).toBe(102_065 + 127_580);
  });
  it('an extra of 200.000 in December: 612.385 - (102.065 + 127.580 + 200.000) = 182.740 over 3 months (Jan to Mar) = 60.914', () => {
    const afterSkip = withPlan({ ...base, entries: [skip('2026-11')] }, '2026-12', 127_580);
    const preview = sinkingExtraPreview(afterSkip, target, due, '2026-12-12', 'IDR', 200_000, false);
    expect(preview).toEqual({ savedMinor: 429_645, monthlyMinor: 60_914, wasMonthlyMinor: 127_580, monthsLeft: 3, promisedMinor: 200_000 });
    // Kept at the old figure, the fund finishes early.
    expect(sinkingExtraPreview(afterSkip, target, due, '2026-12-12', 'IDR', 200_000, true)).toMatchObject({ monthlyMinor: 127_580, savedMinor: 429_645 });
  });
  it('adding November back restores it and recalculates: 408.255 over 4 months = 102.064', () => {
    expect(recalcMonthly(612_385 - 2 * 102_065, 4, 'IDR')).toBe(102_064);
    expect(sinkingRecalc(base, target, due, '2026-11-05', 'IDR')).toMatchObject({ monthlyMinor: 102_064, monthsLeft: 4 });
  });
  it('the mock: 150.000 already saved and a 50.000 extra in November', () => {
    const mock: SinkingFundFacts = { ...base, entries: [opening(150_000, '2026-10-10'), extra(50_000, '2026-11-12')] };
    expect(sinkingProgress(mock, target, due, '2026-11-20')).toMatchObject({ savedMinor: 150_000 + 50_000 + 2 * 102_065, monthsDone: 2 });
  });
});

describe('months left and rounding', () => {
  const fund: SinkingFundFacts = { monthlyMinor: 100_000, startedMonth: '2026-10', entries: [] };
  it('one month left puts the whole remaining amount in that one month (never fewer than one)', () => {
    expect(sinkingRecalc({ ...fund, startedMonth: '2026-02' }, 1_000_000, '2026-03', '2026-02-10', 'IDR')).toMatchObject({ monthsLeft: 1, monthlyMinor: 900_000 });
    expect(sinkingRecalc({ ...fund, startedMonth: '2026-02' }, 1_000_000, '2026-02', '2026-02-10', 'IDR').monthsLeft).toBe(1);
  });
  it('from the form (now) the current month counts among the months left', () => {
    expect(sinkingRecalc(fund, 1_200_000, '2027-04', '2026-10-05', 'IDR', 'now')).toEqual({ monthlyMinor: 200_000, monthsLeft: 6, effectiveFrom: '2026-10' });
  });
  it('rounds up to a whole major unit of the currency', () => {
    expect(recalcMonthly(10_000, 8, 'USD')).toBe(1_300);
    expect(recalcMonthly(0, 3, 'IDR')).toBe(0);
    expect(recalcMonthly(100, 0, 'IDR')).toBe(100);
  });
  it('a due month already passed means the next occurrence a year on', () => {
    expect(sinkingPlan({ repeatMonth: 3, dayOfMonth: 10, currency: 'IDR', targetMinor: 1_200_000, today: '2026-03-20' })).toMatchObject({ dueMonth: '2027-03', monthsLeft: 12, monthlyMinor: 100_000 });
  });
});

describe('saving the form', () => {
  const common = { targetMinor: 612_385, today: '2026-10-10', dueMonth: '2027-04', currency: 'IDR' };
  it('a new fund counts Already saved before working the monthly figure out', () => {
    const r = sinkingSavePlan({ ...common, existing: null, existingCustom: false, typedMonthlyMinor: null, openingMinor: 150_000 });
    // (612.385 - 150.000) / 6 = 77.064,17 -> 77.065
    expect(r.facts.monthlyMinor).toBe(77_065);
    expect(sinkingProgress(r.facts, 612_385, '2027-04', '2026-10-10').savedMinor).toBe(150_000 + 77_065);
    expect(r.custom).toBe(false);
  });
  it('a typed figure is kept and marks the fund custom', () => {
    expect(sinkingSavePlan({ ...common, existing: null, existingCustom: false, typedMonthlyMinor: 90_000 })).toMatchObject({ custom: true, facts: { monthlyMinor: 90_000 } });
  });
  it('an edit with nothing new changes nothing; a cleared custom figure recalculates from the current month', () => {
    const existing: SinkingFundFacts = { monthlyMinor: 102_065, startedMonth: '2026-10', entries: [] };
    expect(sinkingSavePlan({ ...common, existing, existingCustom: false, typedMonthlyMinor: null }).plan).toBeNull();
    const cleared = sinkingSavePlan({ ...common, today: '2026-11-05', existing: { ...existing, entries: [plan('2026-11', 90_000)] }, existingCustom: true, typedMonthlyMinor: null });
    expect(cleared.custom).toBe(false);
    // Settled before November: 102.065; 510.320 over the 5 months November to March = 102.064.
    expect(cleared.plan).toEqual({ from: '2026-11', monthlyMinor: 102_064 });
  });
});

describe('history', () => {
  it('lists newest first, marks the current month, and leaves months not begun out', () => {
    const fund: SinkingFundFacts = { monthlyMinor: 102_065, startedMonth: '2026-10', entries: [opening(150_000, '2026-10-10'), extra(50_000, '2026-11-12'), skip('2026-10')] };
    const rows = sinkingHistory(fund, 612_385, '2027-04', '2026-11-20');
    expect(rows.map((r) => [r.kind, r.date, r.amountMinor, r.skipped, r.current])).toEqual([
      ['extra', '2026-11-12', 50_000, false, false],
      ['month', '2026-11', 102_065, false, true],
      ['month', '2026-10', 0, true, false],
      ['opening', '2026-10-10', 150_000, false, false],
    ]);
    expect(rows[1]).toMatchObject({ index: 2, monthsTotal: 6 });
  });
});
