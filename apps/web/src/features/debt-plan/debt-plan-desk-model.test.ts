import { formatMinor, type InstalmentPayment, instalmentDates, instalmentStanding, type LoanTerms, loanSchedule } from '@expanses/core';
import type { LoanPlanFact } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import {
  comingUp,
  deskDebtRows,
  type DeskContext,
  groupWords,
  lateCell,
  lateHead,
  lateOf,
  lateRows,
  nextPayments,
  payoffLines,
  payoffStartMinor,
  rangeWords,
  toggleTick,
  yearTicks,
} from './debt-plan-desk-model';
import { readings, TODAY } from './plan-fixtures';
import type { PlanItem } from './plan-inputs';
import { planModel } from './queries';
import { monthItems, monthTotals } from './schedule-view';

/**
 * Invented: on 4 Nov 2026 the paylater Kredit (Rp 6.000.000, 6 months from 1 Aug) has only August paid, so September,
 * October and November are late; BCA Visa's statement is due 18 Nov; Dewi is owed Rp 850.000 by 3 Dec.
 */
const TERMS: LoanTerms = { originalMinor: 6_000_000, firstPaymentOn: '2026-08-01', tenorMonths: 6, method: 'annuity', paymentDay: 1 };
const PERIODS = [{ fromOn: '2026-08-01', rateBps: 3_540, kind: 'fixed' as const, paymentMinor: 0 }];
const OWED = 5_020_000;

function lateKredit(): LoanPlanFact {
  const payments: InstalmentPayment[] = [{ id: 't1', occurredOn: '2026-08-01', totalMinor: 1_110_000, fromMessage: false }];
  return {
    accountId: 'L1',
    owedMinor: OWED,
    trackFrom: '2026-08-01',
    instalments: instalmentStanding(instalmentDates(TERMS, '2026-08-01', '2026-11-30'), payments, TODAY),
    scheduleFrom: TODAY,
    schedule: loanSchedule(OWED, TERMS, PERIODS, TODAY),
  };
}

const lateReadings = (extraMinor = 0) => {
  // The dollar loan with no terms would leave the month unknown: this household has none.
  const base = readings();
  const r = readings({ loanFacts: [lateKredit()], accounts: base.accounts.filter((a) => a.id !== 'L2'), balances: { ...base.balances, L1: -OWED, L2: 0 } });
  return { r, model: planModel(r, extraMinor > 0 ? { method: 'avalanche', order: [], extraMinor, extraCurrency: 'IDR' } : null, TODAY) };
};

const ctxOf = (r: ReturnType<typeof readings>, model: ReturnType<typeof planModel>): DeskContext => ({ today: TODAY, loanFacts: r.loanFacts, baseCurrency: 'IDR', ratesToBase: model.ratesToBase });

describe('late payments, per debt', () => {
  it('a loan’s every late instalment, oldest first, as the Schedule lists them; the table’s cell adds them up', () => {
    const { r, model } = lateReadings();
    const kredit = model.debts.find((d) => d.key === 'L1')!;
    const late = lateOf(kredit, ctxOf(r, model));
    expect(late.map((i) => i.dueOn)).toEqual(['2026-09-01', '2026-10-01', '2026-11-01']);
    expect(late.every((i) => i.status === 'late')).toBe(true);
    const cell = lateCell(late)!;
    expect(cell.words).toBe('3 payments late');
    expect(cell.minor).toBe(late.reduce((sum, i) => sum + i.minor!, 0));
    // The same items the Schedule's month holds for it.
    const month = monthItems({ month: '2026-11', today: TODAY, debts: model.debts, loanFacts: r.loanFacts, cards: [], bills: [], show: { loans: true, cards: false, bills: false }, baseCurrency: 'IDR', ratesToBase: {} });
    expect(month.filter((i) => i.debtKey === 'L1' && i.status === 'late').map((i) => i.key)).toEqual(late.map((i) => i.key));
  });

  it('nothing late reads no cell; a card past its due day is one payment late', () => {
    expect(lateCell([])).toBeNull();
    const r = readings({ cards: { C1: { last4: null, hasTerms: true, dueOn: '2026-11-01', billedMinor: 6_214_300, leftToPayMinor: 6_214_300 } } });
    const model = planModel(r, null, TODAY);
    const visa = model.debts.find((d) => d.kind === 'card')!;
    expect(lateCell(lateOf(visa, ctxOf(r, model)))).toEqual({ words: '1 payment late', minor: 6_214_300, currency: 'IDR' });
  });

  it('the peek’s next payments: what is late first, then what comes next, three in all', () => {
    const { r, model } = lateReadings();
    const kredit = model.debts.find((d) => d.key === 'L1')!;
    const rows = nextPayments(kredit, ctxOf(r, model));
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.late)).toEqual(['64 days late', '34 days late', '3 days late']);
    expect(rows[0]!.when).toBe('Sep · 2/6');
    const fresh = readings();
    const ontime = planModel(fresh, null, TODAY);
    const next = nextPayments(ontime.debts.find((d) => d.key === 'L1')!, { today: TODAY, loanFacts: fresh.loanFacts, baseCurrency: 'IDR', ratesToBase: {} });
    expect(next[0]!.late).toBe('3 days late');
    expect(next[1]!.late).toBeNull();
    // The late month is never listed again as one to come.
    expect(next.filter((row) => row.when.includes('Nov'))).toHaveLength(1);
    expect(next[1]!.when).toBe('1 Dec · 5/6');
  });
});

const item = (o: Partial<PlanItem> & Pick<PlanItem, 'key' | 'dueOn'>): PlanItem => ({
  debtKey: null,
  kind: 'bill',
  name: 'x',
  title: 'x',
  detail: '',
  status: 'late',
  daysLate: 1,
  minor: 100,
  currency: 'IDR',
  baseMinor: 100,
  approximate: false,
  paidOn: null,
  fromMessage: false,
  pay: null,
  ...o,
});

describe('the Schedule’s late section: one row per debt', () => {
  const kpr = (dueOn: string, minor = 5_950_000) => item({ key: `loan:KPR:${dueOn}`, debtKey: 'KPR', kind: 'loan', name: 'KPR BCA', title: `KPR BCA · ${dueOn.slice(5, 7)}/120`, dueOn, minor, baseMinor: minor });
  const late = [
    kpr('2025-01-05'),
    kpr('2025-02-05'),
    kpr('2026-11-05'),
    item({ key: 'loan:KTA:2026-10-20', debtKey: 'KTA', kind: 'loan', name: 'KTA', title: 'KTA · 3/24', dueOn: '2026-10-20', minor: 2_770_630, baseMinor: 2_770_630 }),
    item({ key: 'card:C1:2026-11-03', debtKey: 'C1', kind: 'card', name: 'BCA Visa', title: 'BCA Visa', dueOn: '2026-11-03', minor: 5_128_000, baseMinor: 5_128_000 }),
    item({ key: 'bill:B1:2026-11-02', kind: 'bill', name: 'Water', title: 'Water', dueOn: '2026-11-02', minor: 250_000, baseMinor: 250_000 }),
    item({ key: 'bill:B2:2026-11-01', kind: 'bill', name: 'Gym', title: 'Gym', dueOn: '2026-11-01', minor: 400_000, baseMinor: 400_000, inTotals: false }),
  ];

  it('a loan with two or more late is ONE row with its count, range and total; the rest stay their own rows, by oldest', () => {
    const rows = lateRows(late);
    expect(rows.map((row) => (row.type === 'group' ? row.key : row.item.title))).toEqual(['group:KPR', 'KTA · 3/24', 'Gym', 'Water', 'BCA Visa']);
    const group = rows[0]!;
    if (group.type !== 'group') throw new Error('expected a group');
    expect(groupWords(group)).toBe('3 instalments late');
    expect(group.range).toBe('Jan 2025 – Nov 2026');
    expect(group.minor).toBe(3 * 5_950_000);
    expect(group.items.map((i) => i.dueOn)).toEqual(['2025-01-05', '2025-02-05', '2026-11-05']);
  });

  it('the header counts debts and bills, and its total is the Late box’s own (bills on a card left out of both)', () => {
    const head = lateHead(late);
    expect(head.words).toBe('3 debts · 2 bills');
    expect(head.totalMinor).toBe(monthTotals(late, '2026-11').lateMinor);
    expect(head.totalMinor).toBe(3 * 5_950_000 + 2_770_630 + 5_128_000 + 250_000);
  });

  it('a missing rate leaves the total unknown, never short', () => {
    expect(lateHead([item({ key: 'a', dueOn: '2026-11-01', currency: 'USD', baseMinor: null })]).totalMinor).toBeNull();
  });

  it('range words: one month alone, or from – to', () => {
    expect(rangeWords('2026-10-20', '2026-10-28')).toBe('Oct 2026');
    expect(rangeWords('2025-01-05', '2026-11-05')).toBe('Jan 2025 – Nov 2026');
  });

  it('a tick on a later instalment ticks the earlier ones of its loan; unticking unticks the later ones', () => {
    const rows = [...late, kpr('2026-12-05')].map((i) => (i.dueOn === '2026-12-05' ? { ...i, status: 'upcoming' as const } : i));
    const third = rows.find((i) => i.dueOn === '2026-11-05')!;
    const picked = toggleTick(new Set(), third, rows);
    expect([...picked].sort()).toEqual(['loan:KPR:2025-01-05', 'loan:KPR:2025-02-05', 'loan:KPR:2026-11-05']);
    const second = rows.find((i) => i.dueOn === '2025-02-05')!;
    expect([...toggleTick(picked, second, rows)]).toEqual(['loan:KPR:2025-01-05']);
  });

  it('coming up: the next 30 days across the month’s end, soonest first, each once', () => {
    const up = (key: string, dueOn: string) => item({ key, dueOn, status: 'upcoming', title: key });
    const rows = comingUp([up('a', '2026-11-20'), up('b', '2026-11-05')], [up('c', '2026-12-03'), up('d', '2026-12-10'), up('a', '2026-11-20')], TODAY);
    expect(rows.map((r) => r.key)).toEqual(['b', 'a', 'c']);
  });
});

describe('the Debts table: the phone’s pay-first order', () => {
  it('late debts first (no number), then numbered by the chosen order, each with its late and next cells', () => {
    const { r, model } = lateReadings();
    const rows = deskDebtRows(model.debts, model.effect.plan.order, model.extraMinor, ctxOf(r, model));
    expect(rows[0]!.row.debt.key).toBe('L1');
    expect(rows[0]!.row.place).toBeNull();
    expect(rows[0]!.late?.words).toBe('3 payments late');
    expect(rows.slice(1).map((row) => row.row.place)).toEqual(rows.slice(1).map((_, i) => i + 1));
    expect(rows.map((row) => row.row.debt.key)).toEqual(model.effect.plan.order.filter((key) => rows.some((row) => row.row.debt.key === key)));
    // Kredit is an online loan: its kind and rate words are the Liabilities page's.
    expect(rows[0]!.look.key).toBe('online_loan');
    expect(rows[0]!.rate).toBe('2,95% a month');
    const dewi = rows.find((row) => row.row.debt.kind === 'person')!;
    expect(dewi.next).toBe(`3 Dec · ${formatMinor(850_000, 'IDR')}`);
    expect(dewi.late).toBeNull();
  });
});

describe('left to pay over time: today’s projection run twice', () => {
  it('with an extra: two lines, each ending at nothing in its own debt-free month', () => {
    const { model } = lateReadings(2_000_000);
    const start = payoffStartMinor(model.debts);
    const lines = payoffLines(model.effect, model.extraMinor, '2026-11', start)!;
    expect(lines.plan.endMonth).toBe(model.effect.plan.debtFreeMonth);
    expect(lines.without!.endMonth).toBe(model.effect.baseline.debtFreeMonth);
    expect(lines.plan.endMonth < lines.without!.endMonth).toBe(true);
    expect(lines.plan.points[0]).toBe(start);
    expect(lines.plan.points.at(-1)).toBe(0);
    expect(lines.without!.points.at(-1)).toBe(0);
    expect(lines.span).toBe(lines.without!.points.length - 1);
  });

  it('a bigger extra brings the line’s end month forward', () => {
    const { model: small } = lateReadings(500_000);
    const { model: big } = lateReadings(3_000_000);
    const end = (m: typeof small) => payoffLines(m.effect, m.extraMinor, '2026-11', payoffStartMinor(m.debts))!.plan.endMonth;
    expect(end(big) < end(small)).toBe(true);
  });

  it('no extra: one line only', () => {
    const { model } = lateReadings();
    const lines = payoffLines(model.effect, 0, '2026-11', payoffStartMinor(model.debts))!;
    expect(lines.without).toBeNull();
    expect(lines.plan.endMonth).toBe(model.effect.baseline.debtFreeMonth);
  });

  it('year ticks: the start’s year when room is left, then each January', () => {
    expect(yearTicks('2026-11', 30)).toEqual([
      { at: 2, label: '2027' },
      { at: 14, label: '2028' },
      { at: 26, label: '2029' },
    ]);
    expect(yearTicks('2026-03', 12)).toEqual([
      { at: 0, label: '2026' },
      { at: 10, label: '2027' },
    ]);
  });
});
