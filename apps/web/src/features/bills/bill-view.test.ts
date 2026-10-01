import { billWindow, parseMajor } from '@expanses/core';
import type { MonthlyBill } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { amountInput, owedNow, paidText, sectionsOf, settledOf, skippedText, statusOf, sublineOf, summaryOf } from './bill-view';

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
  billMonth: '2026-09',
  window: billWindow('2026-09', 1, null),
  state: 'open',
  days: 5,
  paidOn: null,
  paidMinor: null,
  paymentId: null,
  estimateMinor: 100,
  payableMonths: ['2026-09'],
  pausedUntil: null,
  pauseFrom: '2026-09',
  ...over,
});

const rows = [
  bill({ name: 'Biznet', state: 'overdue', amountMinor: 450_000, estimateMinor: 450_000, billMonth: '2026-08' }),
  bill({ name: 'Tuition', state: 'dueSoon', amountMinor: 3_500_000, estimateMinor: 3_500_000 }),
  bill({ name: 'Telkomsel', state: 'open', amountMinor: null, estimateMinor: 290_000 }),
  bill({ name: 'PLN', state: 'upcoming', amountMinor: null, estimateMinor: 780_000 }),
  bill({ name: 'Rent', state: 'paid', amountMinor: 6_000_000, paidMinor: 6_000_000, paidOn: '2026-09-01' }),
  bill({ name: 'Gym', state: 'skipped', amountMinor: 350_000 }),
];

describe('the Recurring list', () => {
  it('groups what is still to pay by urgency', () => {
    expect(sectionsOf(rows).map((s) => [s.title, s.rows.map((r) => r.name)])).toEqual([
      ['Overdue', ['Biznet']],
      ['Due soon', ['Tuition']],
      ['Later', ['Telkomsel', 'PLN']],
    ]);
  });

  it('folds what is paid and skipped into one row, counting what was paid', () => {
    expect(settledOf(rows, '2026-09-08')).toEqual({
      title: 'Paid and skipped in September',
      count: 2,
      paidMinor: 6_000_000,
      rows: [rows[4], rows[5]],
    });
    expect(settledOf([rows[4]!], '2026-09-08')).toMatchObject({ title: 'Paid in September', count: 1 });
    expect(settledOf([rows[5]!], '2026-09-08')).toMatchObject({ title: 'Skipped in September', paidMinor: 0 });
    expect(settledOf(rows.slice(0, 4), '2026-09-08')).toBeNull();
  });

  it('says under each amount how late, how soon, or which day', () => {
    expect(statusOf({ ...rows[0]!, days: 3 })).toEqual({ text: '3 days late', tone: 'alarm' });
    expect(statusOf({ ...rows[0]!, days: 1 })).toEqual({ text: '1 day late', tone: 'alarm' });
    expect(statusOf({ ...rows[1]!, days: 2 })).toEqual({ text: 'in 2 days', tone: 'warn' });
    expect(statusOf({ ...rows[1]!, days: 0 })).toEqual({ text: 'due today', tone: 'warn' });
    const later = billWindow('2026-09', 10, 20);
    expect(statusOf({ ...rows[2]!, window: later })).toEqual({ text: '20 Sep', tone: 'ink-3' });
    expect(statusOf({ ...rows[3]!, window: later })).toEqual({ text: 'Opens 10 Sep', tone: 'ink-3' });
    expect(statusOf({ ...rows[3]!, window: billWindow('2026-09', 20, null) })).toEqual({ text: '20 Sep', tone: 'ink-3' });
    expect(statusOf(rows[4]!)).toEqual({ text: 'Paid 1 Sep', tone: 'tint' });
    expect(statusOf(rows[5]!)).toEqual({ text: 'Skipped', tone: 'ink-3' });
  });

  it('adds up what is still to pay, saying when estimates are in it', () => {
    expect(summaryOf(rows, '2026-09-08')).toEqual({
      monthLabel: 'September',
      totalMinor: 450_000 + 3_500_000 + 290_000 + 780_000,
      approximate: true,
      variesText: '2 amounts vary',
      parts: [
        { key: 'overdue', label: 'Overdue', minor: 450_000, approximate: false },
        { key: 'dueSoon', label: 'Due soon', minor: 3_500_000, approximate: false },
        { key: 'later', label: 'Later', minor: 1_070_000, approximate: true },
      ],
      allSettled: false,
      allPaused: false,
    });
    expect(summaryOf([rows[4]!], '2026-09-08')).toMatchObject({ totalMinor: 0, parts: [], allSettled: true, allPaused: false });
  });

  it('leaves a paused bill out of what is still to pay, and says until when under its amount', () => {
    const paused = bill({ name: 'Gym', state: 'paused', amountMinor: 350_000, pausedUntil: '2027-01' });
    expect(summaryOf([...rows, paused], '2026-09-08').totalMinor).toBe(summaryOf(rows, '2026-09-08').totalMinor);
    expect(owedNow([...rows, paused])).toEqual(owedNow(rows));
    expect(sectionsOf([paused])).toEqual([]);
    expect(summaryOf([paused], '2026-09-08')).toMatchObject({ totalMinor: 0, allSettled: true, allPaused: true });
    expect(statusOf(paused)).toEqual({ text: 'until Jan 2027', tone: 'ink-3' });
  });

  it('owed now is what is out and unpaid', () => {
    expect(owedNow(rows)).toEqual({ minor: 450_000 + 3_500_000 + 290_000, approximate: true });
  });

  it('names an earlier month in the subline', () => {
    expect(sublineOf(rows[0]!, 'BCA Tahapan', '2026-09-08')).toBe('Aug bill · BCA Tahapan');
    expect(sublineOf(rows[1]!, 'BCA Tahapan', '2026-09-08')).toBe('BCA Tahapan');
  });

  it('writes a bill’s amount in the currency of the account that pays it', () => {
    expect(amountInput(1500, 'USD')).toBe('15.00');
    expect(parseMajor(amountInput(1500, 'USD'), 'USD')).toBe(1500);
    expect(parseMajor(amountInput(150_000, 'IDR'), 'IDR')).toBe(150_000);
    expect(amountInput(null, 'USD')).toBe('');
  });

  it('names the bills a payment recorded', () => {
    expect(paidText(['Internet'])).toBe('Paid Internet');
    expect(paidText(['Internet', 'Phone'])).toBe('Paid 2 bills');
  });

  it('a skip names its month when it is not this month', () => {
    expect(skippedText('Gym', '2026-09', '2026-09-08')).toBe('Skipped Gym this month');
    expect(skippedText('Gym', '2026-08', '2026-09-08')).toBe('Skipped Gym’s August bill');
    expect(skippedText('Gym', '2026-10', '2026-09-08')).toBe('Skipped Gym’s October bill');
  });
});
