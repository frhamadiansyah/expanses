import { parsePeriod } from '@expanses/core';
import type { AccountRow, TransactionView } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { amountLook, buildRows, countsInOrOut, dayTotal, EMPTY_FILTERS, filterRows, groupByCategory, groupByDay, leaveOutYearlyBills, markSpread, totals, yearlyBillsOut } from './list-model';
import { leavesOutYearlyBills, periodCountsYearlyBills, yearlyBillsNote } from './yearly-bills';
import { sortFilterCount, yearlyBillsHint } from './SortFilterMenu';

/*
 * Yearly bills on Cashflow (owner, 2026-11-18): over a month or less a payment linked to a yearly bill is listed in grey
 * and left out of the ring, the total and the day's total; a year or longer — or the ⋯ menu's switch — counts it. Every
 * name and figure here is invented.
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

describe('which rows are yearly bills', () => {
  it('only a payment linked to a yearly bill: a monthly bill and an unlinked purchase are not', () => {
    expect(rows.find((row) => row.id === yearly.id)?.yearlyBill).toBe(true);
    expect(rows.find((row) => row.id === monthly.id)?.yearlyBill).toBeUndefined();
    expect(rows.find((row) => row.id === dinner.id)?.yearlyBill).toBeUndefined();
  });
});

describe('a month leaves them out', () => {
  const out = leaveOutYearlyBills(rows);
  const shown = filterRows(out, march, accounts, true);

  it('still lists the yearly bill, whole, in grey', () => {
    const row = shown.find((r) => r.id === yearly.id)!;
    expect(row).toBeDefined();
    expect(row.amountMinor).toBe(8_400_000_00);
    expect(row.yearlyOut).toBe(true);
    expect(countsInOrOut(row)).toBe(true);
    expect(amountLook(row)).toEqual({ sign: 0, plus: false, muted: true });
    // An account's balance list is never handed these rows, but would read it as it moved.
    expect(amountLook(row, 'balance')).toEqual({ sign: -1, plus: false, muted: false });
  });

  it('counts it in no total: the list, the day (Rp 0 alone) and its category', () => {
    expect(totals(shown).spentMinor).toBe(390_000_00 + 176_000_00);
    const days = groupByDay(shown);
    expect(dayTotal(days.find((day) => day.date === '2027-03-05')!.rows)).toBe(0);
    expect(dayTotal(days.find((day) => day.date === '2027-03-04')!.rows)).toBe(-(390_000_00 + 176_000_00));
    expect(groupByCategory(shown).find((group) => group.id === 'cover')?.totalMinor).toBe(390_000_00);
    expect(yearlyBillsOut(shown)).toBe(1);
  });

  it('leaves the monthly bill and the purchase as they were', () => {
    expect(out.find((r) => r.id === monthly.id)).toEqual(rows.find((r) => r.id === monthly.id));
    expect(out.find((r) => r.id === dinner.id)).toEqual(rows.find((r) => r.id === dinner.id));
  });

  it('a year, or the switch on, counts it like any spending', () => {
    const counted = filterRows(rows, { ...EMPTY_FILTERS, month: '2027' }, accounts, true);
    expect(totals(counted).spentMinor).toBe(8_400_000_00 + 390_000_00 + 176_000_00);
    expect(yearlyBillsOut(counted)).toBe(0);
    expect(amountLook(counted.find((r) => r.id === yearly.id)!)).toEqual({ sign: -1, plus: false, muted: false });
  });

  it('an excluded or deleted yearly bill is not said again in the note; a spread one is left to its plan', () => {
    const marked = buildRows([tx('Old cover', '2027-03-06', 'cover', 1_000_00, { yearlyBill: true, excluded: true })], [], accounts, []);
    expect(yearlyBillsOut(leaveOutYearlyBills(marked))).toBe(0);
    const spread = markSpread(buildRows([yearly], [], accounts, []), new Map([[yearly.id, 12]]));
    expect(leaveOutYearlyBills(spread)[0]?.yearlyOut).toBeUndefined();
  });
});

describe('the period decides', () => {
  const at = (value: string) => periodCountsYearlyBills(parsePeriod(value));
  it('a week, a month and a quarter leave them out; a year and all time count them', () => {
    expect(at('2027-W10')).toBe(false);
    expect(at('2027-03')).toBe(false);
    expect(at('2027-Q1')).toBe(false);
    expect(at('2027')).toBe(true);
    expect(at('all')).toBe(true);
  });

  it('two chosen dates count them only 365 days or more, both days counted', () => {
    expect(at('2027-03-01..2027-03-31')).toBe(false);
    expect(at('2027-03-01..2028-02-27')).toBe(false); // 364 days
    expect(at('2027-03-01..2028-02-28')).toBe(true); // 365 days
    expect(at('2026-01-01..2027-12-31')).toBe(true);
  });

  it('the switch on counts them in a month too; off, only a month leaves them out', () => {
    expect(leavesOutYearlyBills(parsePeriod('2027-03'), false)).toBe(true);
    expect(leavesOutYearlyBills(parsePeriod('2027-03'), true)).toBe(false);
    expect(leavesOutYearlyBills(parsePeriod('2027'), false)).toBe(false);
    expect(leavesOutYearlyBills(null, false)).toBe(true);
  });
});

describe('the words', () => {
  it('says how many are not in the ring, and nothing for none', () => {
    expect(yearlyBillsNote(0)).toBeNull();
    expect(yearlyBillsNote(1)).toBe('1 yearly bill not in the ring');
    expect(yearlyBillsNote(2)).toBe('2 yearly bills not in the ring');
  });

  it('the menu row says what the switch does, and the dot counts it on', () => {
    expect(yearlyBillsHint(false, false)).toBe('Off: listed, not in the ring or total');
    expect(yearlyBillsHint(true, false)).toBe('On: in the ring and total');
    expect(yearlyBillsHint(false, true)).toBe('A year always counts them');
    expect(sortFilterCount({ sortValue: 'date:desc', paid: '', yearlyBills: true })).toBe(1);
    expect(sortFilterCount({ sortValue: 'date:desc', paid: '' })).toBe(0);
  });

  it('never says "you"', () => {
    const words = [yearlyBillsNote(1), yearlyBillsNote(3), yearlyBillsHint(false, false), yearlyBillsHint(true, false), yearlyBillsHint(false, true)].join(' ');
    expect(words).not.toMatch(/\byou(r)?\b/i);
  });
});
