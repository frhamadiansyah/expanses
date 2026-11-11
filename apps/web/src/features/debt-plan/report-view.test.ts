import type { DebtMovement } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import type { PlanDebt, PlanItem } from './plan-inputs';
import { monthBars, monthTag, periodMonths, reportFigures } from './report-view';

describe('periodMonths', () => {
  it('this month, three months, this year, everything', () => {
    expect(periodMonths('month', '2026-11-11', null)).toEqual(['2026-11']);
    expect(periodMonths('3m', '2026-11-11', null)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(periodMonths('year', '2026-11-11', null)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    expect(periodMonths('all', '2026-11-11', '2026-08-15')).toEqual(['2026-08', '2026-09', '2026-10', '2026-11']);
    expect(periodMonths('all', '2026-11-11', null)).toEqual(['2026-11']);
  });
});

const move = (accountId: string, occurredOn: string, amountMinor: number, interestMinor = 0): DebtMovement => ({ transactionId: `${accountId}-${occurredOn}`, accountId, occurredOn, amountMinor, chargesMinor: interestMinor, interestMinor, fromMessage: false });
const movements = [move('L1', '2026-10-01', -6_000_000), move('C1', '2026-10-20', -6_214_300), move('L1', '2026-11-11', 951_155, 120_000)];
const debt = (key: string, leftBase: number, currency = 'IDR'): PlanDebt => ({ key, accountId: key, leftBase, leftMinor: leftBase, currency, paidOff: false, missing: null }) as PlanDebt;
const debts = [debt('L1', 5_048_845), debt('C1', 6_214_300)];
const currencies = { L1: 'IDR', C1: 'IDR' };

describe('reportFigures', () => {
  it('this month: nothing borrowed, the payment and its interest', () => {
    expect(reportFigures(movements, debts, ['2026-11'], 'IDR', {}, currencies)).toEqual({ borrowedMinor: 0, repaidMinor: 951_155, interestMinor: 120_000, leftMinor: 11_263_145, missing: [] });
  });
  it('everything: what was borrowed less what was repaid is what is left', () => {
    const all = reportFigures(movements, debts, ['2026-10', '2026-11'], 'IDR', {}, currencies);
    expect(all).toMatchObject({ borrowedMinor: 12_214_300, repaidMinor: 951_155 });
    expect(all.leftMinor).toBe(all.borrowedMinor! - all.repaidMinor!);
  });
  it('a dollar movement with no rate is named, never added as rupiah; what is known still shows', () => {
    const usd = reportFigures([...movements, move('U1', '2026-11-02', -100_000)], debts, ['2026-11'], 'IDR', {}, { ...currencies, U1: 'USD' });
    expect(usd).toMatchObject({ borrowedMinor: 0, repaidMinor: 951_155, interestMinor: 120_000, missing: ['USD'] });
    const rated = reportFigures([...movements, move('U1', '2026-11-02', -100_000)], debts, ['2026-11'], 'IDR', { USD: 16_250 }, { ...currencies, U1: 'USD' });
    expect(rated.borrowedMinor).toBe(16_250_000);
  });
});

const item = (dueOn: string, status: PlanItem['status'], baseMinor: number): PlanItem =>
  ({ key: `x:${dueOn}:${status}`, debtKey: 'L1', kind: 'loan', name: 'Kredit', title: 'Kredit', detail: '', dueOn, status, daysLate: status === 'late' ? 3 : 0, minor: baseMinor, currency: 'IDR', baseMinor, approximate: false, paidOn: status === 'paid' ? dueOn : null, fromMessage: false, pay: null }) as PlanItem;

describe('reportFigures, more', () => {
  it('a debt with no rate and no movement in the period leaves the period’s figures alone', () => {
    const dollar = { ...debt('U1', 0, 'USD'), leftBase: null, leftMinor: 100_000 } as PlanDebt;
    const f = reportFigures(movements, [...debts, dollar], ['2026-11'], 'IDR', {}, { ...currencies, U1: 'USD' });
    expect(f).toMatchObject({ borrowedMinor: 0, repaidMinor: 951_155, interestMinor: 120_000, leftMinor: null, missing: ['USD'] });
  });
  it('interest on one payment that lowers two debts is counted once', () => {
    const both = [
      { ...move('L1', '2026-11-11', 500_000, 120_000), transactionId: 't' },
      { ...move('C1', '2026-11-11', 451_155, 120_000), transactionId: 't' },
    ];
    expect(reportFigures(both, debts, ['2026-11'], 'IDR', {}, currencies)).toMatchObject({ repaidMinor: 951_155, interestMinor: 120_000 });
  });
});

describe('monthBars and monthTag', () => {
  const byMonth = {
    '2026-08': [] as PlanItem[],
    '2026-09': [item('2026-09-01', 'paid', 1_071_155)],
    '2026-10': [item('2026-10-01', 'late', 1_071_155), item('2026-10-18', 'paid', 6_214_300)],
    '2026-11': [item('2026-11-01', 'paid', 1_071_155), item('2026-11-18', 'upcoming', 4_000_000)],
  };
  const bars = monthBars(byMonth, ['2026-08', '2026-09', '2026-10', '2026-11'], '2026-11-11');
  it('due and paid per month, the current one so far', () => {
    expect(bars.map((b) => [b.month, b.dueMinor, b.paidMinor])).toEqual([
      ['2026-08', 0, 0],
      ['2026-09', 1_071_155, 1_071_155],
      ['2026-10', 7_285_455, 6_214_300],
      ['2026-11', 5_071_155, 1_071_155],
    ]);
    expect(bars.map((b) => b.soFar)).toEqual([false, false, false, true]);
  });
  it('a figure counted toward due or paid is used when an item carries one', () => {
    const card = { ...item('2026-10-14', 'paid', 18_000_000), kind: 'card' as const, dueBaseMinor: 3_000_000, paidBaseMinor: 3_000_000 };
    const [bar] = monthBars({ '2026-10': [card] }, ['2026-10'], '2026-11-11');
    expect(bar).toMatchObject({ dueMinor: 3_000_000, paidMinor: 3_000_000, allPaid: true });
  });
  it('each month’s tag', () => {
    expect(bars.map(monthTag)).toEqual(['Nothing due', 'All paid', '1 late', '']);
    expect(bars[0]).toMatchObject({ nothingDue: true, allPaid: false });
    expect(bars[2]).toMatchObject({ late: 1, allPaid: false });
  });
});
