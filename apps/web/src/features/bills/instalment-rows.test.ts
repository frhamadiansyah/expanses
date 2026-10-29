import { billWindow } from '@expanses/core';
import type { CardInstallmentRow, MonthlyBill } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { annualFeesOf } from '../cards/fee-due';
import { summaryOf } from './bill-view';
import { instalmentLines } from './instalment-rows';

const plan = (over: Partial<CardInstallmentRow>): CardInstallmentRow =>
  ({
    id: 'p1',
    cardAccountId: 'card',
    transactionId: null,
    description: 'Laptop',
    createdAt: '2026-01-01',
    totalMinor: 1_200_000,
    months: 12,
    firstBilledMonth: '2026-08',
    monthlyMinor: 100_000,
    rateBps: 0,
    conversionFeeMinor: 0,
    ...over,
  }) as CardInstallmentRow;

const cards = [{ id: 'card', name: 'Visa', currency: 'IDR' }];

const bill = (over: Partial<MonthlyBill>): MonthlyBill =>
  ({
    id: 'b',
    name: 'Phone',
    amountMinor: 150_000,
    billMonth: '2026-10',
    window: billWindow('2026-10', 1, null),
    state: 'overdue',
    days: 3,
    paidOn: null,
    currency: null,
    repeat: 'monthly',
    estimateMinor: null,
    ...over,
  }) as MonthlyBill;

describe('instalmentLines', () => {
  it('lists a running plan as "name · card" with how far through it is, and its monthly figure', () => {
    const [line] = instalmentLines([plan({})], cards, 'IDR', '2026-10-15');
    expect(line).toMatchObject({ title: 'Laptop · Visa', monthlyMinor: 100_000, currency: 'IDR', detail: '3 of 12 · on the statement' });
  });

  it('leaves out a plan that has finished, and one on a card that is gone', () => {
    expect(instalmentLines([plan({ firstBilledMonth: '2025-01' })], cards, 'IDR', '2026-10-15')).toEqual([]);
    expect(instalmentLines([plan({ cardAccountId: 'gone' })], cards, 'IDR', '2026-10-15')).toEqual([]);
  });

  it('keeps the last month listed, and a plan not yet on a statement', () => {
    expect(instalmentLines([plan({ firstBilledMonth: '2025-11' })], cards, 'IDR', '2026-10-15')).toHaveLength(1);
    expect(instalmentLines([plan({ firstBilledMonth: '2026-12' })], cards, 'IDR', '2026-10-15')[0]!.detail).toBe('0 of 12 · on the statement');
  });

  it('is in no bills total: the summary reads the bills alone, with or without plans', () => {
    const bills = [bill({})];
    const before = summaryOf(bills, '2026-10-15');
    instalmentLines([plan({}), plan({ id: 'p2', description: 'Phone case' })], cards, 'IDR', '2026-10-15');
    expect(summaryOf(bills, '2026-10-15')).toEqual(before);
  });
});

describe('annualFeesOf', () => {
  const card = (over: object) => ({ cardId: 'c', name: 'A', currency: 'IDR', annualFeeMinor: null, annualFeeOn: null, annualFeeWaivedYear: null, ...over });
  it('keeps cards with an amount or a date, by date, and sets none of it against a need', () => {
    const rows = annualFeesOf(
      [card({ cardId: '1', name: 'None' }), card({ cardId: '2', name: 'Dated', annualFeeOn: '2024-12-01' }), card({ cardId: '3', name: 'Amount only', annualFeeMinor: 500_000 }), card({ cardId: '4', name: 'Free', annualFeeMinor: 0, annualFeeOn: '2024-11-01' })],
      '2026-10-15',
    );
    expect(rows.map((r) => r.card.name)).toEqual(['Dated', 'Amount only']);
    expect(rows[0]!.on).toBe('2026-12-01');
    expect(rows[1]!.on).toBeNull();
  });
});
