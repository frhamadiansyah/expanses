import { billWindow } from '@expanses/core';
import type { BillMonthRow, MonthlyBill } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { summaryOf } from './bill-view';
import { asMonthlyBill, barMonths, barScale, billsOn, calendarWeeks, compactWithSymbol, countedNote, dayMarks, deskGroups, deskStatus, isDueSoon, monthBarOf, monthBoxOf, pickedTotal, trendCaption } from './bills-desk-model';

const bill = (over: Partial<MonthlyBill>): MonthlyBill => ({
  id: over.name ?? 'x',
  name: 'x',
  categoryAccountId: 'c',
  moneyAccountId: 'm',
  amountMinor: 100,
  dayOfMonth: 1,
  payByDay: null,
  startsMonth: '2026-08',
  active: true,
  billMonth: '2026-12',
  window: billWindow('2026-12', 1, null),
  state: 'open',
  days: 5,
  paidOn: null,
  paidMinor: null,
  paidCurrency: null,
  chargedMinor: null,
  chargedCurrency: null,
  currency: null,
  repeat: 'monthly',
  repeatMonth: null,
  repeatEvery: null,
  paymentId: null,
  paidFromAccountId: null,
  estimateMinor: 100,
  payableMonths: ['2026-12'],
  pausedUntil: null,
  pauseFrom: '2026-12',
  ...over,
});

const on = (day: number, month = '2026-12') => billWindow(month, day, null);

// Today is 30 Nov 2026 in the invented household, whose December reads like the mockup's.
const today = '2026-11-30';
const rows = [
  bill({
    name: 'PLN token',
    state: 'overdue',
    days: 2,
    amountMinor: 500_000,
    billMonth: '2026-11',
    window: on(28, '2026-11'),
  }),
  bill({
    name: 'BCA Visa bill',
    state: 'dueSoon',
    days: 2,
    amountMinor: 8_400_000,
    window: on(2),
  }),
  bill({
    name: 'Indihome',
    state: 'open',
    days: 5,
    amountMinor: 385_000,
    window: on(5),
  }),
  bill({
    name: 'BPJS',
    state: 'upcoming',
    days: 10,
    amountMinor: null,
    estimateMinor: 450_000,
    window: on(10),
  }),
  bill({
    name: 'Home loan',
    state: 'upcoming',
    days: 15,
    amountMinor: 4_950_000,
    window: on(15),
  }),
  bill({
    name: 'Water',
    state: 'paid',
    amountMinor: null,
    estimateMinor: 160_000,
    paidMinor: 165_000,
    paidOn: '2026-11-30',
    window: on(1),
  }),
  bill({
    name: 'School fee',
    state: 'paid',
    amountMinor: 2_500_000,
    paidMinor: 2_500_000,
    paidOn: '2026-11-29',
    window: on(1),
  }),
  bill({
    name: 'Netflix',
    state: 'skipped',
    amountMinor: 186_000,
    window: on(12),
  }),
  bill({
    name: 'Gym',
    state: 'paused',
    amountMinor: 450_000,
    pausedUntil: '2027-01',
    window: on(12),
  }),
];

describe('the month calendar', () => {
  it('lays a month out in whole weeks, Monday first, with the neighbours’ days faint', () => {
    const weeks = calendarWeeks('2026-12');
    expect(weeks).toHaveLength(5);
    // 1 December 2026 is a Tuesday.
    expect(weeks[0]!.map((d) => d.day)).toEqual([30, 1, 2, 3, 4, 5, 6]);
    expect(weeks[0]![0]).toEqual({
      date: '2026-11-30',
      day: 30,
      inMonth: false,
    });
    expect(weeks.at(-1)!.map((d) => [d.day, d.inMonth])).toEqual([
      [28, true],
      [29, true],
      [30, true],
      [31, true],
      [1, false],
      [2, false],
      [3, false],
    ]);
    // February 2027 starts on a Monday and has 28 days: four weeks exactly, nothing faint.
    expect(calendarWeeks('2027-02')).toHaveLength(4);
    expect(calendarWeeks('2027-02')[0]![0]!.date).toBe('2027-02-01');
  });

  it('marks each day by its most pressing bill: soon over later over paid, nothing for skipped or paused', () => {
    const marks = dayMarks(rows, today);
    expect(marks.get('2026-11-28')).toBe('soon');
    expect(marks.get('2026-12-02')).toBe('soon');
    expect(marks.get('2026-12-05')).toBe('later');
    expect(marks.get('2026-12-15')).toBe('later');
    expect(marks.get('2026-12-01')).toBe('paid');
    // Netflix skipped and Gym paused both fall on the 12th: no mark.
    expect(marks.has('2026-12-12')).toBe(false);
    // A paid bill and one still to come on the same day: the one to come sets it.
    expect(dayMarks([rows[2]!, bill({ name: 'Paid too', state: 'paid', window: on(5) })], today).get('2026-12-05')).toBe('later');
    // Not out yet but due in 3 days: orange, as the table's Due soon lists it.
    expect(dayMarks([bill({ name: 'PLN', state: 'upcoming', window: on(3) })], today).get('2026-12-03')).toBe('soon');
    expect(dayMarks([bill({ name: 'PLN', state: 'upcoming', window: on(4) })], today).get('2026-12-04')).toBe('later');
  });

  it('a selected day lists the bills due on it', () => {
    expect(billsOn(rows, '2026-12-01').map((b) => b.name)).toEqual(['Water', 'School fee']);
    expect(billsOn(rows, '2026-12-03')).toEqual([]);
  });
});

describe('the All bills table', () => {
  it('groups as the phone counts: Due soon, Later, Paid (with skipped), Paused', () => {
    const groups = deskGroups(rows, '2026-12', true, today);
    expect(groups.map((g) => [g.title, g.rows.map((r) => r.name)])).toEqual([
      ['Due soon', ['PLN token', 'BCA Visa bill']],
      ['Later this month', ['Indihome', 'BPJS', 'Home loan']],
      ['Paid this month', ['Water', 'School fee', 'Netflix']],
      ['Paused', ['Gym']],
    ]);
    // A yearly bill listed ahead of its date in next month makes the group plain Later.
    expect(
      deskGroups(
        [
          ...rows,
          bill({
            name: 'Car tax',
            state: 'upcoming',
            window: on(5, '2027-01'),
          }),
        ],
        '2026-12',
        true,
        today,
      )[1]!.title,
    ).toBe('Later');
    // Another month names itself; empty groups are left out.
    expect(deskGroups(rows.slice(5, 7), '2026-10', false, today).map((g) => g.title)).toEqual(['Paid in October']);
  });

  it('puts in Due soon what is late or due within 3 days ("In 3 days" included), out yet or not, and the rest in Later', () => {
    // 17 Nov: PLN comes out and is due on the 20th, a yearly bill on 7 Dec. Invented.
    const on17 = '2026-11-17';
    const pln = bill({ name: 'PLN', state: 'upcoming', days: 3, billMonth: '2026-11', window: on(20, '2026-11') });
    const internet = bill({ name: 'Internet', state: 'upcoming', days: 4, billMonth: '2026-11', window: on(21, '2026-11') });
    const late = bill({ name: 'Water', state: 'overdue', days: 2, billMonth: '2026-11', window: on(15, '2026-11') });
    const yearly = bill({ name: 'Licence', state: 'upcoming', days: 20, window: on(7) });
    const groups = deskGroups([pln, internet, late, yearly], '2026-11', true, on17);
    expect(groups.map((g) => [g.key, g.rows.map((r) => r.name)])).toEqual([
      ['dueSoon', ['PLN', 'Water']],
      ['later', ['Internet', 'Licence']],
    ]);
    // Every Due soon row is a due-soon row, and no Later row is: the group never says otherwise than its dates.
    for (const group of groups) for (const each of group.rows) expect(isDueSoon(each, on17)).toBe(group.key === 'dueSoon');
    expect(deskStatus(pln, on17)).toEqual({ text: 'Due in 3 days', tone: 'warn' });
    expect(deskStatus(internet, on17)).toEqual({ text: 'In 4 days', tone: 'ink-3' });
    // Paid, skipped and paused are never due soon.
    for (const state of ['paid', 'skipped', 'paused'] as const) expect(isDueSoon({ ...pln, state }, on17)).toBe(false);
  });

  it('notes a bill due after the month it is counted in', () => {
    const insurance = bill({ name: 'Car insurance', state: 'upcoming', window: on(5) });
    expect(countedNote(insurance, '2026-11')).toBe('due 5 Dec · counted in Nov');
    expect(countedNote(insurance, '2026-12')).toBeNull();
    expect(countedNote(bill({ name: 'Rent', window: on(28, '2026-11') }), '2026-11')).toBeNull();
  });

  it('Due soon and Later add up to what is left to pay, and the paid group’s paid rows to Paid', () => {
    const groups = deskGroups(rows, '2026-12', true, today);
    const box = monthBoxOf(rows, today);
    const sum = (list: MonthlyBill[]) => list.reduce((s, b) => s + (b.state === 'paid' ? b.paidMinor! : (b.amountMinor ?? b.estimateMinor ?? 0)), 0);
    const toPay = groups.filter((g) => g.key === 'dueSoon' || g.key === 'later').flatMap((g) => g.rows);
    expect(sum(toPay)).toBe(box.leftMinor);
    expect(sum(groups.find((g) => g.key === 'paid')!.rows.filter((b) => b.state === 'paid'))).toBe(box.paidMinor);
  });

  it('says where each bill stands in the Status column', () => {
    expect(deskStatus(rows[0]!, today)).toEqual({
      text: '2 days late',
      tone: 'alarm',
    });
    expect(deskStatus(rows[1]!, today)).toEqual({
      text: 'Due in 2 days',
      tone: 'warn',
    });
    expect(deskStatus(bill({ state: 'dueSoon', days: 0 }), today)).toEqual({
      text: 'Due today',
      tone: 'warn',
    });
    // Counted to the day it is due, whether it is out yet or not.
    expect(deskStatus(rows[2]!, today)).toEqual({
      text: 'In 5 days',
      tone: 'ink-3',
    });
    expect(deskStatus(rows[4]!, today)).toEqual({
      text: 'In 15 days',
      tone: 'ink-3',
    });
    expect(deskStatus(bill({ state: 'open', window: on(1) }), '2026-11-30')).toEqual({ text: 'Due in 1 day', tone: 'warn' });
    expect(deskStatus(rows[5]!, today)).toEqual({
      text: 'Paid 30 Nov',
      tone: 'gain',
    });
    expect(deskStatus(rows[7]!, today)).toEqual({
      text: 'Skipped',
      tone: 'ink-3',
    });
    expect(deskStatus(rows[8]!, today)).toEqual({
      text: 'Paused until Jan 2027',
      tone: 'ink-3',
    });
    expect(deskStatus(bill({ state: 'paused' }), today).text).toBe('Paused');
  });

  it('the ticked bills add up in the bar, ~ when one varies, and nothing settled counts', () => {
    expect(pickedTotal(rows, new Set(['BCA Visa bill', 'Indihome']))).toEqual({
      minor: 8_785_000,
      approximate: false,
    });
    expect(pickedTotal(rows, new Set(['BPJS', 'Water']))).toEqual({
      minor: 450_000,
      approximate: true,
    });
  });
});

describe('the month’s box', () => {
  it('is the phone’s summary: left to pay, paid, the whole month, and how many of the bills that count are paid', () => {
    const box = monthBoxOf(rows, today);
    const summary = summaryOf(rows, today);
    expect(box).toEqual({
      leftMinor: 500_000 + 8_400_000 + 385_000 + 450_000 + 4_950_000,
      paidMinor: 165_000 + 2_500_000,
      totalMinor: summary.monthTotalMinor,
      paidCount: 2,
      count: 7,
      approximate: true,
      allPaid: false,
      allPaused: false,
    });
    expect(box.leftMinor + box.paidMinor).toBe(box.totalMinor);
  });

  it('says all paid only when something was owed, and all paused apart', () => {
    expect(monthBoxOf(rows.slice(5, 8), today).allPaid).toBe(true);
    expect(monthBoxOf([], today).allPaid).toBe(false);
    const paused = monthBoxOf([rows[8]!], today);
    expect([paused.allPaid, paused.allPaused, paused.count]).toEqual([false, true, 0]);
  });
});

describe('bills each month', () => {
  it('shows the five months before and the month itself', () => {
    expect(barMonths('2026-12')).toEqual(['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12']);
  });

  it('a month gone by is what was paid; this month and later the whole bill, hatched — the box’s own figures', () => {
    const box = monthBoxOf(rows, today);
    expect(monthBarOf('2026-12', rows, '2026-12', today)).toEqual({
      month: '2026-12',
      minor: box.totalMinor,
      expected: true,
    });
    expect(monthBarOf('2026-10', rows, '2026-12', today)).toEqual({
      month: '2026-10',
      minor: box.paidMinor,
      expected: false,
    });
    expect(monthBarOf('2027-01', rows, '2026-12', today).expected).toBe(true);
  });

  it('says in a plain line what the month has due and what the month before paid, with no percentage', () => {
    const bars = [
      { month: '2026-10', minor: 3_412_000, expected: false },
      { month: '2026-11', minor: 10_196_500, expected: true },
    ];
    expect(trendCaption(bars, 'IDR')).toBe('November: Rp\u00a010,2 jt due · October paid Rp\u00a03,4 jt');
    // A month gone by says what it paid; below a million, whole rupiah; nothing paid reads Rp 0.
    expect(trendCaption([{ ...bars[0]!, minor: 0 }, { ...bars[1]!, minor: 950_000, expected: false }], 'IDR')).toBe('November: Rp\u00a0950.000 paid · October paid Rp\u00a00');
    expect(trendCaption(bars.slice(1), 'IDR')).toBeNull();
    expect(compactWithSymbol(-8_400_000, 'IDR')).toBe('−Rp\u00a08,4 jt');
    expect(compactWithSymbol(184_000, 'USD')).toBe('US$1.840');
  });

  it('labels the bars in jt, rb, or whole units of another money', () => {
    expect(barScale(16_521_000, 'IDR').unit).toBe('jt');
    expect(barScale(16_521_000, 'IDR').label(14_200_000)).toBe('14,2');
    expect(barScale(900_000, 'IDR').unit).toBe('rb');
    expect(barScale(900_000, 'IDR').label(385_000)).toBe('385');
    expect(barScale(184_000, 'USD')).toMatchObject({ unit: 'USD' });
    expect(barScale(184_000, 'USD').label(184_000)).toBe('1.840');
  });
});

describe('another month’s bills', () => {
  it('read as the list’s rows: its month, its standing, nothing payable ahead', () => {
    const row: BillMonthRow = {
      bill: { ...bill({ name: 'Water' }) },
      month: '2026-10',
      window: on(1, '2026-10'),
      state: 'paid',
      days: 0,
      paidOn: '2026-10-02',
      paidMinor: 150_000,
      paidCurrency: 'IDR',
      chargedMinor: null,
      chargedCurrency: null,
      paymentId: 't1',
      paidFromAccountId: 'm',
      payments: [{ id: 't1', paidMinor: 150_000, paidCurrency: 'IDR', linked: false }],
      estimateMinor: 160_000,
    };
    const shaped = asMonthlyBill(row);
    expect(shaped).toMatchObject({
      name: 'Water',
      billMonth: '2026-10',
      state: 'paid',
      paidMinor: 150_000,
      estimateMinor: 160_000,
      payableMonths: [],
      pausedUntil: null,
      pauseFrom: '2026-10',
    });
    expect('payments' in shaped).toBe(false);
  });
});
