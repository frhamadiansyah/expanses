import { instalmentDates, instalmentStanding, type LoanTerms, loanSchedule } from '@expanses/core';
import type { BillMonthRow, CardStatement, LoanPlanFact } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { account, card, kreditFact, loanRow, readings } from './plan-fixtures';
import { planDebts } from './plan-inputs';
import { billPay, cardPay, loanPay } from './pay-target';
import { type CardMonth, dueRow, dueThisMonthCount, type MonthInput, monthItems, monthSections, monthTotals } from './schedule-view';

/**
 * November 2026: the paylater's 4/6 (due 1 Nov) unpaid, BCA Visa's October statement due 18 Nov, Electricity pay-by
 * 20 Nov, and the mortgage's 63/120 paid on 1 Nov from a bank message.
 */
const KPR_TERMS: LoanTerms = { originalMinor: 300_000_000, firstPaymentOn: '2021-09-01', tenorMonths: 120, method: 'annuity', paymentDay: 1 };
const KPR_PERIODS = [{ fromOn: '2021-09-01', rateBps: 750, kind: 'fixed' as const, paymentMinor: 2_480_000 }];

function kprFact(today: string): LoanPlanFact {
  const dues = instalmentDates(KPR_TERMS, '2026-11-01', '2026-11-30');
  return {
    accountId: 'KPR',
    owedMinor: 180_000_000,
    trackFrom: '2026-11-01',
    instalments: instalmentStanding(dues, [{ id: 'k1', occurredOn: '2026-11-01', totalMinor: 2_480_000, fromMessage: true }], today),
    scheduleFrom: '2026-12-01',
    schedule: loanSchedule(180_000_000, KPR_TERMS, KPR_PERIODS, '2026-12-01'),
  };
}

const statement = (closingMinor: number, leftToPayMinor: number | null, closed = true, o: Partial<CardStatement> = {}) =>
  ({
    cycle: { start: '2026-10-01', end: '2026-10-31' },
    currency: 'IDR',
    openingMinor: 0,
    chargesMinor: closingMinor,
    creditsMinor: 0,
    closingMinor,
    lines: [],
    closed,
    paidSinceMinor: leftToPayMinor === null ? 0 : closingMinor - leftToPayMinor,
    leftToPayMinor,
    ...o,
  }) as CardStatement;

const visa = (closingMinor = 6_214_300, left: number | null = 6_214_300): CardMonth => ({ cardId: 'C1', name: 'BCA Visa', currency: 'IDR', dueOn: '2026-11-18', statement: statement(closingMinor, left) });

const electricity = (state: BillMonthRow['state'] = 'open', paid: Partial<BillMonthRow> = {}): BillMonthRow =>
  ({
    month: '2026-11',
    window: { month: '2026-11', opensOn: '2026-11-10', payBy: '2026-11-20' },
    state,
    days: 0,
    paidOn: null,
    paidMinor: null,
    paidCurrency: null,
    chargedMinor: null,
    chargedCurrency: null,
    paymentId: null,
    paidFromAccountId: null,
    payments: [],
    bill: { id: 'B1', name: 'Electricity', categoryAccountId: 'cat', moneyAccountId: 'bank', amountMinor: 780_000, dayOfMonth: 10, active: true, payByDay: 20, startsMonth: '2026-09', currency: null, repeat: 'monthly', repeatMonth: null, repeatEvery: null },
    estimateMinor: 780_000,
    ...paid,
  }) as BillMonthRow;

function input(today: string, o: { kredit?: LoanPlanFact; month?: string; show?: MonthInput['show']; cards?: CardMonth[]; bills?: BillMonthRow[] } = {}): MonthInput {
  const base = readings();
  const r = readings({
    accounts: [...base.accounts.filter((a) => a.id !== 'L2' && a.id !== 'L3'), account({ id: 'KPR', name: 'KPR BCA', subtype: 'loan' })],
    balances: { ...base.balances, KPR: -180_000_000 },
    loans: [loanRow({ accountId: 'L1' }), loanRow({ accountId: 'KPR', lenderName: 'BCA', ...KPR_TERMS, periods: [{ id: 'k', accountId: 'KPR', ...KPR_PERIODS[0]! }] })],
    loanFacts: [o.kredit ?? kreditFact(today), kprFact(today)],
    cards: { C1: card({ billedMinor: 6_214_300, leftToPayMinor: 6_214_300, dueOn: '2026-11-18' }) },
  });
  const debts = planDebts(r, today);
  return {
    month: o.month ?? '2026-11',
    today,
    debts,
    loanFacts: r.loanFacts,
    cards: o.cards ?? [visa()],
    bills: (o.bills ?? [electricity()]).map((row) => ({ row, currency: 'IDR' })),
    show: o.show ?? { loans: true, cards: true, bills: true },
    baseCurrency: 'IDR',
    ratesToBase: {},
  };
}

const kreditNov = (today: string) => kreditFact(today).schedule.find((r) => r.onDate.startsWith('2026-11'))!.paymentMinor;
const titles = (items: { title: string }[]) => items.map((i) => i.title);

describe('monthItems and monthSections', () => {
  it('late, coming up and paid, each with its own words and Pay', () => {
    const items = monthItems(input('2026-11-04'));
    const s = monthSections(items, '2026-11', '2026-11-04');
    expect(titles(s.late)).toEqual(['Kredit · 4/6']);
    expect(titles(s.comingUp)).toEqual(['BCA Visa', 'Electricity']);
    expect(titles(s.paid)).toEqual(['KPR BCA · 63/120']);
    expect(s.paid[0]).toMatchObject({ fromMessage: true, paidOn: '2026-11-01', minor: 2_480_000, pay: null });
    expect(s.late[0]).toMatchObject({ daysLate: 3, pay: loanPay('L1'), minor: kreditNov('2026-11-04') });
    expect(s.comingUp[0]).toMatchObject({ detail: 'Statement · 18 Nov', pay: cardPay('C1'), minor: 6_214_300 });
    expect(s.comingUp[1]).toMatchObject({ detail: 'Bill · 20 Nov', pay: billPay('B1'), minor: 780_000, kind: 'bill', debtKey: null });
  });

  it('totals: due, paid and late; the switches take items out of both', () => {
    const items = monthItems(input('2026-11-04'));
    expect(monthTotals(items, '2026-11')).toEqual({ dueMinor: kreditNov('2026-11-04') + 6_214_300 + 780_000 + 2_480_000, paidMinor: 2_480_000, lateMinor: kreditNov('2026-11-04'), missing: [] });
    const noBills = monthItems(input('2026-11-04', { show: { loans: true, cards: true, bills: false } }));
    expect(titles(noBills)).not.toContain('Electricity');
    expect(monthTotals(noBills, '2026-11').dueMinor).toBe(kreditNov('2026-11-04') + 6_214_300 + 2_480_000);
  });

  it('a late instalment of an earlier month is in this month’s late section, not in its due', () => {
    const fact = kreditFact('2026-11-04');
    const missedOct = { ...fact, instalments: fact.instalments.map((i) => (i.number === 3 ? { ...i, status: 'late' as const, paidOn: null, paymentId: null, paidMinor: null, fromMessage: false, daysLate: 34 } : i)) };
    const items = monthItems(input('2026-11-04', { kredit: missedOct }));
    const s = monthSections(items, '2026-11', '2026-11-04');
    expect(s.late.map((i) => [i.title, i.detail])).toEqual([
      ['Kredit · 3/6', 'Oct instalment'],
      ['Kredit · 4/6', 'Instalment · 1 Nov'],
    ]);
    const totals = monthTotals(items, '2026-11');
    expect(totals.dueMinor).toBe(kreditNov('2026-11-04') + 6_214_300 + 780_000 + 2_480_000);
    expect(totals.lateMinor).toBe(2 * kreditNov('2026-11-04'));
  });

  it('a statement that billed nothing is not an item; one not yet closed says so far', () => {
    expect(titles(monthItems(input('2026-11-04', { cards: [visa(0, 0)] })))).not.toContain('BCA Visa');
    const open = monthItems(input('2026-11-04', { cards: [{ ...visa(), statement: statement(6_214_300, null, false) }] })).find((i) => i.title === 'BCA Visa')!;
    expect(open).toMatchObject({ approximate: true, status: 'upcoming' });
  });

  it('a paid statement and a paid bill are paid; a skipped bill is not listed', () => {
    const items = monthItems(input('2026-11-21', { cards: [visa(6_214_300, 0)], bills: [electricity('paid', { paidOn: '2026-11-19', paidMinor: 812_000, paidCurrency: 'IDR' })] }));
    const s = monthSections(items, '2026-11', '2026-11-21');
    expect(s.paid.find((i) => i.title === 'Electricity')).toMatchObject({ paidOn: '2026-11-19', minor: 812_000, pay: null });
    expect(s.paid.some((i) => i.title === 'BCA Visa')).toBe(true);
    expect(titles(monthItems(input('2026-11-04', { bills: [electricity('skipped')] })))).not.toContain('Electricity');
  });

  it('a bill belongs to the month its pay-by day falls in; an earlier month’s overdue one is carried into this one', () => {
    const outLate = electricity('upcoming', { month: '2026-11', window: { month: '2026-11', opensOn: '2026-11-28', payBy: '2026-12-05' } });
    expect(titles(monthItems(input('2026-11-04', { bills: [outLate] })))).not.toContain('Electricity');
    const october = electricity('overdue', { month: '2026-10', window: { month: '2026-10', opensOn: '2026-10-10', payBy: '2026-10-20' } });
    const items = monthItems(input('2026-11-04', { bills: [october, electricity()] }));
    const s = monthSections(items, '2026-11', '2026-11-04');
    expect(s.late.find((i) => i.kind === 'bill')).toMatchObject({ title: 'Electricity', dueOn: '2026-10-20', daysLate: 15 });
    expect(monthTotals(items, '2026-11').dueMinor).toBe(kreditNov('2026-11-04') + 6_214_300 + 780_000 + 2_480_000);
    // Looking back at October, the same bill is October's.
    expect(titles(monthItems(input('2026-11-04', { month: '2026-10', cards: [], bills: [october] })))).toContain('Electricity');
  });

  it('a month ahead shows scheduled instalments as upcoming, numbered from the first', () => {
    const items = monthItems(input('2026-11-04', { month: '2026-12', cards: [], bills: [] }));
    expect(items.find((i) => i.title.startsWith('KPR BCA'))).toMatchObject({ title: 'KPR BCA · 64/120', status: 'upcoming', dueOn: '2026-12-01' });
    expect(items.every((i) => i.status === 'upcoming')).toBe(true);
  });

  it('counts what is still due this month', () => {
    expect(dueThisMonthCount(monthItems(input('2026-11-04')), '2026-11')).toBe(3);
  });
});

describe('a card statement part paid, or carried from month to month', () => {
  it('a late statement asks for what is left — the figure Pay next asks — and counts what was paid', () => {
    // Closed at 10.000.000, due 5 Nov, 6.000.000 paid since; today 11 Nov.
    const part = { ...visa(10_000_000, 4_000_000), dueOn: '2026-11-05' };
    const items = monthItems(input('2026-11-11', { cards: [part], bills: [] }));
    const card = items.find((i) => i.kind === 'card')!;
    expect(card).toMatchObject({ status: 'late', minor: 4_000_000, daysLate: 6 });
    const t = monthTotals(items.filter((i) => i.kind === 'card'), '2026-11');
    expect(t).toMatchObject({ dueMinor: 10_000_000, paidMinor: 6_000_000, lateMinor: 4_000_000 });
    expect(dueRow(items.filter((i) => i.kind === 'card'), '2026-11-11')!.item.minor).toBe(4_000_000);
  });

  it('a balance carried through three statements and cleared by one payment is paid once across the months', () => {
    // Aug closes at 10m, Sep at 15m (10m carried + 5m new), Oct at 18m (15m carried + 3m new); 18m paid on 5 Nov.
    const card = (month: string, dueOn: string, opening: number, charges: number) => ({
      cardId: 'C1',
      name: 'BCA Visa',
      currency: 'IDR',
      dueOn,
      statement: statement(opening + charges, 0, true, { openingMinor: opening, chargesMinor: charges, paidSinceMinor: 18_000_000, cycle: { start: `${month}-01`, end: `${month}-28` } }),
    });
    const months = [
      { month: '2026-09', card: card('2026-08', '2026-09-14', 0, 10_000_000) },
      { month: '2026-10', card: card('2026-09', '2026-10-14', 10_000_000, 5_000_000) },
      { month: '2026-11', card: card('2026-10', '2026-11-14', 15_000_000, 3_000_000) },
    ];
    const totals = months.map(({ month, card: c }) => monthTotals(monthItems(input('2026-11-20', { month, cards: [c], bills: [], show: { loans: false, cards: true, bills: true } })), month));
    expect(totals.reduce((s, t) => s + t.paidMinor, 0)).toBe(18_000_000);
    expect(totals.reduce((s, t) => s + t.dueMinor, 0)).toBe(18_000_000);
    expect(totals.map((t) => t.lateMinor)).toEqual([0, 0, 0]);
  });
});

describe('a loan paid off', () => {
  it('keeps its months behind, paid, and never shows late or ahead', () => {
    // Bank (in the fixtures): paid off on 15 Sep 2026; instalments 1/6 (1 Aug) and 2/6 (1 Sep) paid.
    const bankTerms = { firstPaymentOn: '2026-08-01', paymentDay: 1, tenorMonths: 6 };
    const bank: LoanPlanFact = {
      accountId: 'L3',
      owedMinor: 0,
      trackFrom: '2026-08-01',
      instalments: instalmentStanding(instalmentDates(bankTerms, '2026-08-01', '2026-09-15'), [
        { id: 'b1', occurredOn: '2026-08-01', totalMinor: 400_000, fromMessage: false },
        { id: 'b2', occurredOn: '2026-09-15', totalMinor: 1_600_000, fromMessage: false },
      ], '2026-11-04'),
      scheduleFrom: '2026-09-15',
      schedule: [],
    };
    const base = input('2026-11-04', { month: '2026-09', cards: [], bills: [] });
    const all = planDebts(readings(), '2026-11-04');
    const september = monthItems({ ...base, debts: all, loanFacts: [...base.loanFacts, bank] });
    expect(september.find((i) => i.debtKey === 'L3')).toMatchObject({ title: 'Bank · 2/6', status: 'paid', paidOn: '2026-09-15', minor: 1_600_000 });
    const november = monthItems({ ...base, month: '2026-11', debts: all, loanFacts: [...base.loanFacts, bank] });
    expect(november.some((i) => i.debtKey === 'L3')).toBe(false);
  });
});

describe('a bill paid from a credit card', () => {
  it('keeps its row, says which card, and stays out of the totals the statement already counts', () => {
    const items = monthItems({ ...input('2026-11-04'), bills: [{ row: electricity(), currency: 'IDR', onCard: 'BCA Visa' }] });
    const bill = items.find((i) => i.kind === 'bill')!;
    expect(bill).toMatchObject({ detail: 'Bill · 20 Nov · on BCA Visa', inTotals: false });
    expect(monthTotals(items, '2026-11').dueMinor).toBe(kreditNov('2026-11-04') + 6_214_300 + 2_480_000);
    expect(dueRow(items, '2026-11-18')?.item.kind).not.toBe('bill');
  });
});

describe('dueRow', () => {
  const on = (day: string, kredit?: LoanPlanFact) => monthItems(input(day, kredit ? { kredit } : {}));
  it('the most late first, then what falls due within three days', () => {
    expect(dueRow(on('2026-11-16'), '2026-11-16')).toMatchObject({ title: 'Kredit instalment', subtitle: '15 days late · +1 due in 2 days', tone: 'alarm', rest: 1 });
    expect(dueRow(on('2026-11-17'), '2026-11-17')).toMatchObject({ subtitle: '16 days late · +2 more', rest: 2 });
  });
  it('one more late item reads +1 late', () => {
    const fact = kreditFact('2026-11-04');
    const missedOct = { ...fact, instalments: fact.instalments.map((i) => (i.number === 3 ? { ...i, status: 'late' as const, paidOn: null, paymentId: null, paidMinor: null, fromMessage: false, daysLate: 34 } : i)) };
    const items = monthItems(input('2026-11-04', { kredit: missedOct })).filter((i) => i.kind === 'loan');
    expect(dueRow(items, '2026-11-04')).toMatchObject({ title: 'Kredit instalment', subtitle: '34 days late · +1 late' });
  });
  it('nothing late: the soonest due', () => {
    const paid = kreditFact('2026-11-17');
    const allPaid = { ...paid, instalments: paid.instalments.map((i) => ({ ...i, status: 'paid' as const, paidOn: i.dueOn, paymentId: `p${i.number}`, paidMinor: 1, daysLate: 0 })) };
    expect(dueRow(on('2026-11-17', allPaid), '2026-11-17')).toMatchObject({ title: 'BCA Visa statement', subtitle: 'Due tomorrow · +1 due in 3 days', tone: 'warn' });
    expect(dueRow(on('2026-11-04', allPaid).filter((i) => i.kind !== 'loan'), '2026-11-04')).toBeNull();
  });
});
