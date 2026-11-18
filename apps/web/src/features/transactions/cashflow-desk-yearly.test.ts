import type { AccountRow, TransactionView } from '@expanses/db';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RingBox } from './CashflowBoxes';
import { deskAmount } from './cashflow-desk-model';
import { buildRows, EMPTY_FILTERS, filterRows, leaveOutYearlyBills, totals, yearlyBillsOut } from './list-model';
import { leavesOutYearlyBills, YEARLY_BILL_LINE, yearlyBillsNote } from './yearly-bills';

/*
 * Mac Cashflow D follows the iPhone's yearly-bills rule (owner, 2026-11-18): over a month a payment of a yearly bill is
 * listed whole, greyed and tagged in the table, and left out of what the month adds up; the switch or a year counts it.
 * The ring and the boxes read the same rule through `categoryTotalsIn(… leaveOutYearlyBills)` (packages/db). Invented
 * names and figures.
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

// A yearly bill paid alone on the 5th, a monthly bill and a dinner on the 4th.
const yearly = tx('Cover premium', '2027-03-05', 'cover', 8_400_000_00, { billMonth: '2027-03', yearlyBill: true });
const monthly = tx('Gym', '2027-03-04', 'cover', 390_000_00, { billMonth: '2027-03' });
const dinner = tx('Warung Contoh', '2027-03-04', 'food', 176_000_00);
const rows = buildRows([yearly, monthly, dinner], [], accounts, []);
const march = { ...EMPTY_FILTERS, month: '2027-03' };

describe('a yearly bill in the desk table', () => {
  it('over a month reads whole, in grey, with "Yearly bill · in the year" first under it', () => {
    const row = leaveOutYearlyBills(rows).find((r) => r.id === yearly.id)!;
    const amount = deskAmount(row);
    expect(amount).toMatchObject({ minor: 8_400_000_00, sign: '', tone: 'grey', yearlyOut: true });
    expect(amount.extra[0]).toEqual({ text: YEARLY_BILL_LINE, tone: 'foreign' });
  });

  it('counted (the switch on, or a year) reads as any spending, with no tag', () => {
    const row = rows.find((r) => r.id === yearly.id)!;
    const amount = deskAmount(row);
    expect(amount).toMatchObject({ minor: 8_400_000_00, tone: 'ink', yearlyOut: false });
    expect(amount.extra.map((part) => part.text)).not.toContain(YEARLY_BILL_LINE);
    // The monthly bill and the dinner never carry it.
    for (const other of rows.filter((r) => r.id !== yearly.id)) expect(deskAmount(leaveOutYearlyBills([other])[0]!).yearlyOut).toBe(false);
  });

  it('adds up, over a month, to the dinner and the monthly bill alone — what the ring and Spent read — and to all three counted', () => {
    const shown = filterRows(leaveOutYearlyBills(rows), march, accounts, true);
    expect(shown.map((r) => r.id)).toContain(yearly.id);
    expect(totals(shown).spentMinor).toBe(390_000_00 + 176_000_00);
    expect(totals(filterRows(rows, march, accounts, true)).spentMinor).toBe(8_400_000_00 + 390_000_00 + 176_000_00);
    expect(yearlyBillsNote(yearlyBillsOut(shown))).toBe('1 yearly bill not in the ring');
  });

  it('is left out by a month with the switch off only: the switch, or a year, counts it', () => {
    expect(leavesOutYearlyBills({ kind: 'month', from: '2027-03-01', to: '2027-03-31' }, false)).toBe(true);
    expect(leavesOutYearlyBills({ kind: 'month', from: '2027-03-01', to: '2027-03-31' }, true)).toBe(false);
    expect(leavesOutYearlyBills({ kind: 'year', from: '2027-01-01', to: '2027-12-31' }, false)).toBe(false);
  });
});

describe('the ring box', () => {
  const ring = (footnote: string | null) =>
    renderToStaticMarkup(
      createElement(RingBox, { kind: 'expense', items: [], totalMinor: 566_000_00, currency: 'IDR', picked: '', onPick: () => {}, icon: () => null, ready: true, period: 'March 2027', footnote }),
    );

  it('says under the ring how many yearly bills it leaves out, and nothing when none are', () => {
    expect(ring('1 yearly bill not in the ring')).toContain('1 yearly bill not in the ring');
    expect(ring(null)).not.toContain('yearly-bills-note');
  });
});
