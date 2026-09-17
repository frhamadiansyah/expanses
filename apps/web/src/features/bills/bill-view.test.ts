import { billWindow, parseMajor } from '@expanses/core';
import type { MonthlyBill } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { amountInput, owedNow, paidText, sectionsOf, skippedText, sublineOf, summaryOf } from './bill-view';

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
  it('groups by urgency and counts what is settled', () => {
    expect(sectionsOf(rows).map((s) => [s.title, s.rows.map((r) => r.name)])).toEqual([
      ['Overdue', ['Biznet']],
      ['Due soon', ['Tuition']],
      ['Later', ['Telkomsel', 'PLN']],
      ['Paid and skipped · 2', ['Rent', 'Gym']],
    ]);
  });

  it('adds up what is still to pay, saying when estimates are in it', () => {
    expect(summaryOf(rows, '2026-09-08')).toEqual({
      monthLabel: 'September',
      totalMinor: 450_000 + 3_500_000 + 290_000 + 780_000,
      approximate: true,
      variesText: '2 amounts vary',
      lines: [
        { key: 'overdue', label: 'Overdue', minor: 450_000, approximate: false },
        { key: 'dueSoon', label: 'Due soon', minor: 3_500_000, approximate: false },
        { key: 'later', label: 'Later this month', minor: 1_070_000, approximate: true },
      ],
      allSettled: false,
    });
    expect(summaryOf([rows[4]!], '2026-09-08')).toMatchObject({ totalMinor: 0, lines: [], allSettled: true });
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
