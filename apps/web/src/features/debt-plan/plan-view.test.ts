import { formatMinor, simulatePayoff } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { repaidPercent } from '../loans/loan-view';
import { loanRow, readings, TODAY } from './plan-fixtures';
import { type PlanDebt, planDebts } from './plan-inputs';
import { lateNote, longMonth, methodLabel, methodOf, payFirstRows, planSummary, rollsWords, suggestionWords, unknownWords, whenWords } from './plan-view';

const debts = planDebts(readings(), TODAY);
const baselineOf = (list: readonly PlanDebt[], method: 'avalanche' | 'snowball' = 'avalanche') =>
  simulatePayoff(list.flatMap((d) => (d.payoff ? [d.payoff] : [])), { startMonth: TODAY.slice(0, 7), method, extraMinor: 0 });

describe('whenWords', () => {
  const at = (dueOn: string, status: 'late' | 'upcoming' = 'upcoming', daysLate = 0) => whenWords({ status, daysLate, dueOn }, '2026-11-11');
  it('says how late, or when it is due', () => {
    expect(at('2026-11-08', 'late', 3)).toBe('3 days late');
    expect(at('2026-11-10', 'late', 1)).toBe('1 day late');
    expect(at('2026-11-11')).toBe('due today');
    expect(at('2026-11-12')).toBe('due tomorrow');
    expect(at('2026-11-18')).toBe('due 18 Nov');
  });
});

describe('longMonth', () => {
  it('writes the month out with its year', () => expect(longMonth('2028-08')).toBe('August 2028'));
});

describe('planSummary', () => {
  const summary = planSummary(debts, baselineOf(debts), TODAY);
  it('counts active, late and paid off', () => expect(summary.counts).toEqual({ active: 4, late: 1, paidOff: 1 }));
  it('the ring is the share repaid, paid-off debts included', () => {
    expect(summary.percent).toBe(repaidPercent(summary.borrowedMinor!, summary.leftMinor!));
    expect(summary.borrowedMinor).toBe(summary.leftMinor! + summary.repaidMinor!);
    expect(summary.borrowedMinor).toBeGreaterThan(summary.leftMinor! + 2_000_000 - 1);
  });
  it('Pay next is the late instalment', () => {
    expect(summary.payNext?.item.title).toBe('Kredit · 4/6');
    expect(summary.payNext?.when).toBe('3 days late');
  });
  it('the loan with no terms makes the month unknown, and names it', () => {
    expect(summary.debtFree).toEqual({ month: null, why: 'No terms on Dollar car loan yet' });
  });
  it('a debt with no rate leaves Left to pay out and names the currency', () => {
    const noRate = planDebts(readings({ ratesToBase: {} }), TODAY);
    const s = planSummary(noRate, baselineOf(noRate), TODAY);
    expect(s).toMatchObject({ leftMinor: null, missing: ['USD'], debtFree: { month: null, why: 'No USD rate yet' } });
  });
  it('with every debt known, the month is the baseline’s, written out', () => {
    const known = debts.filter((d) => d.key !== 'L2');
    const baseline = baselineOf(known);
    expect(planSummary(known, baseline, TODAY).debtFree).toEqual({ month: longMonth(baseline.debtFreeMonth!), why: null });
  });
  it('with nothing late, Pay next is the soonest due', () => {
    const onTime = debts.filter((d) => d.key !== 'L1');
    expect(planSummary(onTime, baselineOf(onTime), TODAY).payNext).toMatchObject({ item: { title: 'BCA Visa' }, when: 'due 18 Nov' });
  });
});

describe('unknownWords', () => {
  it('names the loan with no terms, the debt never cleared, or the missing rate', () => {
    const plan = { ...baselineOf(debts), unknown: { reason: 'noRate' as const, keys: ['L2'] } };
    expect(unknownWords(plan, debts, [])).toBe('No terms on Dollar car loan yet');
    expect(unknownWords({ ...plan, unknown: { reason: 'neverCleared', keys: ['person:Dewi:IDR'] } }, debts, [])).toBe('Payments never clear Dewi');
    expect(unknownWords(plan, debts, ['USD'])).toBe('No USD rate yet');
    expect(unknownWords({ ...plan, unknown: null }, debts, [])).toBeNull();
  });
});

describe('suggestionWords', () => {
  const kpr = planDebts(readings({ accounts: [...readings().accounts, { id: 'KPR', name: 'KPR', kind: 'liability', subtype: 'loan', currency: 'IDR', archivedAt: null }], balances: { ...readings().balances, KPR: -28_400_000 }, loans: [...readings().loans, loanRow({ accountId: 'KPR', periods: [{ id: 'k', accountId: 'KPR', fromOn: '2026-08-01', rateBps: 750, kind: 'fixed', paymentMinor: 0 }] })] }), TODAY);
  it('Avalanche names both rates in their own loan’s wording', () =>
    expect(suggestionWords({ method: 'avalanche', reason: 'ratesDiffer', highestKey: 'L1', lowestKey: 'KPR' }, kpr)).toBe(
      'Suggested: Avalanche. Rates are known for every debt and differ a lot (2,95% a month vs 7,5% a year).',
    ));
  it('Snowball for many small debts, and for unknown rates', () => {
    expect(suggestionWords({ method: 'snowball', reason: 'manySmall', smallCount: 3 }, debts)).toBe('Suggested: Snowball. 3 small debts: clearing them first shortens the list quickly.');
    expect(suggestionWords({ method: 'snowball', reason: 'ratesUnknown' }, debts)).toBe('Suggested: Snowball. Not every rate is known, so the smallest go first.');
    expect(suggestionWords(null, debts)).toBeNull();
  });
});

describe('method', () => {
  it('the saved one, else the suggestion’s, else Avalanche', () => {
    expect(methodOf(null, null)).toBe('avalanche');
    expect(methodOf(null, { method: 'snowball', reason: 'manySmall', smallCount: 3 })).toBe('snowball');
    expect(methodOf({ method: 'byHand', order: [], extraMinor: 0, extraCurrency: null }, { method: 'snowball', reason: 'ratesUnknown' })).toBe('byHand');
    expect(methodOf({ method: null, order: [], extraMinor: 0, extraCurrency: null }, null)).toBe('avalanche');
  });
  it('labels', () => expect([methodLabel('snowball'), methodLabel('avalanche'), methodLabel('byHand')]).toEqual(['Snowball', 'Avalanche', 'By hand']));
});

describe('payFirstRows', () => {
  const order = baselineOf(debts).order;
  const rows = payFirstRows(debts, order, 500_000, 'IDR');
  it('puts the late debt first with "!", and numbers the rest', () => {
    expect(rows[0]).toMatchObject({ place: null, lateTag: '3 days late' });
    expect(rows[0]!.debt.key).toBe('L1');
    expect(rows.slice(1).map((r) => r.place)).toEqual([1, 2, 3]);
  });
  it('gives the first in line the extra only when it is a loan', () => {
    expect(rows[0]!.extraTag).toBe(`+ extra ${formatMinor(500_000, 'IDR')}`);
    expect(rows.slice(1).every((r) => r.extraTag === null)).toBe(true);
    expect(payFirstRows(debts, order, 0, 'IDR')[0]!.extraTag).toBeNull();
    const cardFirst = payFirstRows(debts, ['C1', ...order.filter((k) => k !== 'C1')], 500_000, 'IDR');
    expect(cardFirst.find((r) => r.debt.key === 'C1')!.extraTag).toBeNull();
  });
  it('each kind has its own subtitle, and a debt the engine left out goes last', () => {
    const by = (key: string) => rows.find((r) => r.debt.key === key)!;
    expect(by('L1').subtitle).toBe(`2,95% a month · left ${formatMinor(3_120_400, 'IDR')}`);
    expect(by('L2')).toMatchObject({ subtitle: 'No terms yet', pay: null });
    expect(by('C1').subtitle).toBe('Statement due 18 Nov');
    expect(by('person:Dewi:IDR').subtitle).toBe('Due 3 Dec');
    const noRate = planDebts(readings({ ratesToBase: {} }), TODAY);
    expect(payFirstRows(noRate, baselineOf(noRate).order, 0, 'IDR').at(-1)!.debt.key).toBe('L2');
  });
});

describe('rollsWords and lateNote', () => {
  it('names the first two in line', () => {
    expect(rollsWords(['L1', 'C1'], debts)).toBe('Goes to Kredit, then rolls to BCA Visa');
    expect(rollsWords(['L1'], debts)).toBe('Goes to Kredit');
    expect(rollsWords([], debts)).toBeNull();
  });
  it('the late count', () => {
    expect(lateNote(0)).toBeUndefined();
    expect(lateNote(2)).toBe('2 late');
  });
});

describe('copy', () => {
  it('no string speaks to the reader as "you"', () => {
    const order = baselineOf(debts).order;
    const s = planSummary(debts, baselineOf(debts), TODAY);
    const strings = [
      whenWords({ status: 'late', daysLate: 3, dueOn: '2026-11-01' }, TODAY),
      longMonth('2028-08'),
      unknownWords({ ...baselineOf(debts), unknown: { reason: 'neverCleared', keys: ['L1'] } }, debts, []),
      unknownWords(baselineOf(debts), debts, ['USD']),
      suggestionWords({ method: 'avalanche', reason: 'ratesDiffer', highestKey: 'L1', lowestKey: 'L1' }, debts),
      suggestionWords({ method: 'snowball', reason: 'manySmall', smallCount: 3 }, debts),
      suggestionWords({ method: 'snowball', reason: 'ratesUnknown' }, debts),
      ...payFirstRows(debts, order, 500_000, 'IDR').flatMap((r) => [r.subtitle, r.lateTag, r.extraTag]),
      rollsWords(order, debts),
      lateNote(2),
      s.debtFree.why,
      s.payNext?.when,
      methodLabel('byHand'),
    ];
    for (const text of strings) expect(text ?? '').not.toMatch(/\byou(r|rs)?\b/i);
  });
});
