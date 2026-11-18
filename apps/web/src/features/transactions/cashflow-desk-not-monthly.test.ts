import type { AccountRow, TransactionView } from '@expanses/db';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RingBox } from './CashflowBoxes';
import { deskAmount } from './cashflow-desk-model';
import { buildRows, EMPTY_FILTERS, filterRows, leaveOutNotMonthly, notMonthlyOutCount, totals } from './list-model';
import { leavesOutNotMonthly, notMonthlyNote } from './not-monthly';

/*
 * Mac Cashflow D follows the iPhone's not-monthly rule (owner, 2026-11-18): under a year a payment of a bill that repeats
 * yearly or every 2 months or more is listed whole, its amount grey and a ↻ on its circle, and left out of what the month
 * adds up; Not monthly Shown, or a year, counts it. The ring and the boxes read the same rule through
 * `categoryTotalsIn(… leaveOutNotMonthly)` (packages/db). Invented names and figures.
 */

const account = (id: string, kind: AccountRow['kind'], subtype: AccountRow['subtype'], name: string): AccountRow => ({
  id, workspaceId: 'ws', parentId: null, kind, subtype, name, icon: null, currency: kind === 'expense' ? null : 'IDR', valuationMode: 'derived', systemKey: null, sortOrder: 0, archivedAt: null, createdAt: '2027-01-01T00:00:00Z',
});
const accounts = [account('bank', 'asset', 'bank', 'Contoh Bank'), account('cover', 'expense', 'category', 'Insurance'), account('food', 'expense', 'category', 'Restaurants')];
const byId = new Map(accounts.map((a) => [a.id, a]));

let seq = 0;
function tx(description: string, occurredOn: string, category: string, amountMinor: number, extra: Partial<TransactionView> = {}): TransactionView {
  seq += 1;
  const line = (accountId: string, amount: number, i: number) => {
    const a = byId.get(accountId)!;
    return { id: `t${seq}e${i}`, accountId, accountName: a.name, accountKind: a.kind, accountSubtype: a.subtype, accountSystemKey: null, amountMinor: amount, currency: 'IDR', fxRateToBase: 1, amountBaseMinor: amount, memo: null, spendCategoryId: null } as TransactionView['entries'][number];
  };
  return {
    id: `t${seq}`, occurredOn, description, source: 'manual', status: 'posted', externalRef: null, originalCurrency: null, originalAmountMinor: null, mcc: null, cardId: null, goalId: null,
    createdAt: `2027-03-0${seq}T00:00:00Z`,
    entries: [line(category, amountMinor, 0), line('bank', -amountMinor, 1)],
    ...extra,
  };
}

// A not-monthly bill paid alone on the 5th, a monthly bill and a dinner on the 4th.
const yearly = tx('Cover premium', '2027-03-05', 'cover', 8_400_000_00, { billMonth: '2027-03', notMonthlyBill: true });
const monthly = tx('Gym', '2027-03-04', 'cover', 390_000_00, { billMonth: '2027-03' });
const dinner = tx('Warung Contoh', '2027-03-04', 'food', 176_000_00);
const rows = buildRows([yearly, monthly, dinner], [], accounts, []);
const march = { ...EMPTY_FILTERS, month: '2027-03' };

describe('a not-monthly bill in the desk table', () => {
  it('over a month reads whole and in grey, marked as left out', () => {
    const row = leaveOutNotMonthly(rows).find((r) => r.id === yearly.id)!;
    const amount = deskAmount(row);
    expect(amount).toMatchObject({ minor: 8_400_000_00, sign: '', tone: 'grey', notMonthlyOut: true });
  });

  it('counted (Not monthly Shown, or a year) reads as any spending, unmarked', () => {
    const row = rows.find((r) => r.id === yearly.id)!;
    const amount = deskAmount(row);
    expect(amount).toMatchObject({ minor: 8_400_000_00, tone: 'ink', notMonthlyOut: false });
    // The monthly bill and the dinner never carry it.
    for (const other of rows.filter((r) => r.id !== yearly.id)) expect(deskAmount(leaveOutNotMonthly([other])[0]!).notMonthlyOut).toBe(false);
  });

  it('adds up, over a month, to the dinner and the monthly bill alone — what the ring and Spent read — and to all three counted', () => {
    const shown = filterRows(leaveOutNotMonthly(rows), march, accounts, true);
    expect(shown.map((r) => r.id)).toContain(yearly.id);
    expect(totals(shown).spentMinor).toBe(390_000_00 + 176_000_00);
    expect(totals(filterRows(rows, march, accounts, true)).spentMinor).toBe(8_400_000_00 + 390_000_00 + 176_000_00);
    expect(notMonthlyNote(notMonthlyOutCount(shown))).toBe('1 not in the ring');
  });

  it('is left out under a year with Not monthly Hidden only: Shown, or a year, counts it', () => {
    expect(leavesOutNotMonthly({ kind: 'month', from: '2027-03-01', to: '2027-03-31' }, false)).toBe(true);
    expect(leavesOutNotMonthly({ kind: 'quarter', from: '2027-01-01', to: '2027-03-31' }, false)).toBe(true);
    expect(leavesOutNotMonthly({ kind: 'month', from: '2027-03-01', to: '2027-03-31' }, true)).toBe(false);
    expect(leavesOutNotMonthly({ kind: 'year', from: '2027-01-01', to: '2027-12-31' }, false)).toBe(false);
  });
});

describe('the ring box', () => {
  const ring = (footnote: string | null) =>
    renderToStaticMarkup(
      createElement(RingBox, { kind: 'expense', items: [], totalMinor: 566_000_00, currency: 'IDR', picked: '', onPick: () => {}, icon: () => null, ready: true, period: 'March 2027', footnote }),
    );

  it('says under the ring how many it leaves out, and nothing when none are', () => {
    expect(ring('2 not in the ring')).toContain('2 not in the ring');
    expect(ring(null)).not.toContain('not-monthly-note');
  });
});
