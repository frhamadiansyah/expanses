import { isNotMonthlyRepeat, parsePeriod } from '@expanses/core';
import type { AccountRow, TransactionView } from '@expanses/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { amountLook, buildRows, categoryButtonLabel, countsInOrOut, dayTotal, EMPTY_FILTERS, filterRows, groupByCategory, groupByDay, leaveOutNotMonthly, markSpread, notMonthlyOutCount, totals } from './list-model';
import { leavesOutNotMonthly, NOT_MONTHLY_BILL_NOTE, NOT_MONTHLY_KEY, notMonthlyNote, notMonthlyWord, OLD_YEARLY_BILLS_KEY, periodCountsNotMonthly, readNotMonthlyShown, writeNotMonthlyShown } from './not-monthly';
import { sortFilterCount } from './SortFilterMenu';

/*
 * Not-monthly costs on Cashflow (owner, 2026-11-18): over less than a year a payment linked to a bill that repeats yearly
 * or every 2 months or more is listed, grey, and left out of the ring, the total and the day's total; a year or longer —
 * or the ⋯ menu's Not monthly on Shown — counts it. Every name and figure here is invented.
 */

const account = (id: string, kind: AccountRow['kind'], subtype: AccountRow['subtype'], name: string): AccountRow => ({
  id, workspaceId: 'ws', parentId: null, kind, subtype, name, icon: null, currency: kind === 'expense' ? null : 'IDR', valuationMode: 'derived', systemKey: null, sortOrder: 0, archivedAt: null, createdAt: '2027-01-01T00:00:00Z',
});
const accounts = [account('bank', 'asset', 'bank', 'Contoh Bank'), account('cover', 'expense', 'category', 'Insurance'), account('car', 'expense', 'category', 'Vehicle maintenance'), account('food', 'expense', 'category', 'Restaurants')];
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

// A yearly bill paid alone on the 5th; a car service every 6 months, a monthly bill and a dinner on the 4th.
const yearly = tx('Cover premium', '2027-03-05', 'cover', 8_400_000_00, { billMonth: '2027-03', notMonthlyBill: true });
const service = tx('Car service', '2027-03-04', 'car', 1_930_000_00, { billMonth: '2027-03', notMonthlyBill: true });
const monthly = tx('Gym', '2027-03-04', 'cover', 390_000_00, { billMonth: '2027-03' });
const dinner = tx('Warung Contoh', '2027-03-04', 'food', 176_000_00);
const rows = buildRows([yearly, service, monthly, dinner], [], accounts, []);
const march = { ...EMPTY_FILTERS, month: '2027-03' };

describe('which bills are not monthly', () => {
  it('yearly, and every 2, 3 or 6 months, are not monthly', () => {
    expect(isNotMonthlyRepeat('yearly')).toBe(true);
    expect(isNotMonthlyRepeat('yearly', null)).toBe(true);
    for (const every of [2, 3, 6, 11]) expect(isNotMonthlyRepeat('months', every)).toBe(true);
  });

  it('every month, every 1 month, or a few months without a gap, are monthly', () => {
    expect(isNotMonthlyRepeat('monthly')).toBe(false);
    expect(isNotMonthlyRepeat(null)).toBe(false);
    expect(isNotMonthlyRepeat(undefined)).toBe(false);
    expect(isNotMonthlyRepeat('months', 1)).toBe(false);
    expect(isNotMonthlyRepeat('months', null)).toBe(false);
    expect(isNotMonthlyRepeat('months', 0)).toBe(false);
  });

  it('a row is one only when its payment is linked to such a bill: a monthly bill and an unlinked purchase are not', () => {
    expect(rows.find((row) => row.id === yearly.id)?.notMonthly).toBe(true);
    expect(rows.find((row) => row.id === service.id)?.notMonthly).toBe(true);
    expect(rows.find((row) => row.id === monthly.id)?.notMonthly).toBeUndefined();
    expect(rows.find((row) => row.id === dinner.id)?.notMonthly).toBeUndefined();
  });
});

describe('a month leaves them out', () => {
  const out = leaveOutNotMonthly(rows);
  const shown = filterRows(out, march, accounts, true);

  it('still lists each, whole, its amount grey', () => {
    for (const id of [yearly.id, service.id]) {
      const row = shown.find((r) => r.id === id)!;
      expect(row).toBeDefined();
      expect(row.notMonthlyOut).toBe(true);
      expect(countsInOrOut(row)).toBe(true);
      expect(amountLook(row)).toEqual({ sign: 0, plus: false, muted: true });
      // An account's balance list is never handed these rows, but would read it as it moved.
      expect(amountLook(row, 'balance')).toEqual({ sign: -1, plus: false, muted: false });
    }
    expect(shown.find((r) => r.id === yearly.id)!.amountMinor).toBe(8_400_000_00);
    expect(shown.find((r) => r.id === service.id)!.amountMinor).toBe(1_930_000_00);
  });

  it('counts them in no total: the list, the day (Rp 0 alone) and its category', () => {
    expect(totals(shown).spentMinor).toBe(390_000_00 + 176_000_00);
    const days = groupByDay(shown);
    expect(dayTotal(days.find((day) => day.date === '2027-03-05')!.rows)).toBe(0);
    // The car service shares its day with the gym and the dinner, and adds nothing to it.
    expect(dayTotal(days.find((day) => day.date === '2027-03-04')!.rows)).toBe(-(390_000_00 + 176_000_00));
    expect(groupByCategory(shown).find((group) => group.id === 'cover')?.totalMinor).toBe(390_000_00);
    expect(groupByCategory(shown).find((group) => group.id === 'car')?.totalMinor ?? 0).toBe(0);
    expect(notMonthlyOutCount(shown)).toBe(2);
  });

  it('leaves the monthly bill and the purchase as they were', () => {
    expect(out.find((r) => r.id === monthly.id)).toEqual(rows.find((r) => r.id === monthly.id));
    expect(out.find((r) => r.id === dinner.id)).toEqual(rows.find((r) => r.id === dinner.id));
  });

  it('a year, or Shown, counts them like any spending', () => {
    const counted = filterRows(rows, { ...EMPTY_FILTERS, month: '2027' }, accounts, true);
    expect(totals(counted).spentMinor).toBe(8_400_000_00 + 1_930_000_00 + 390_000_00 + 176_000_00);
    expect(notMonthlyOutCount(counted)).toBe(0);
    expect(amountLook(counted.find((r) => r.id === service.id)!)).toEqual({ sign: -1, plus: false, muted: false });
    // Shown in March: Cashflow hands the rows over untouched (`leavesOutNotMonthly` false), so March counts them too.
    expect(leavesOutNotMonthly(parsePeriod('2027-03'), true)).toBe(false);
    expect(totals(filterRows(rows, march, accounts, true)).spentMinor).toBe(8_400_000_00 + 1_930_000_00 + 390_000_00 + 176_000_00);
  });

  it('an excluded or deleted one is not said again in the note; a spread one is left to its plan', () => {
    const marked = buildRows([tx('Old cover', '2027-03-06', 'cover', 1_000_00, { notMonthlyBill: true, excluded: true })], [], accounts, []);
    expect(notMonthlyOutCount(leaveOutNotMonthly(marked))).toBe(0);
    const spread = markSpread(buildRows([yearly], [], accounts, []), new Map([[yearly.id, 12]]));
    expect(leaveOutNotMonthly(spread)[0]?.notMonthlyOut).toBeUndefined();
  });

  it('the category button says the badge aloud', () => {
    expect(categoryButtonLabel('Car service', { notMonthly: true })).toBe('Category for Car service, not monthly');
  });
});

describe('the period decides', () => {
  const at = (value: string) => periodCountsNotMonthly(parsePeriod(value));
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

  it('Shown counts them in a month too; Hidden, only less than a year leaves them out', () => {
    expect(leavesOutNotMonthly(parsePeriod('2027-03'), false)).toBe(true);
    expect(leavesOutNotMonthly(parsePeriod('2027-03'), true)).toBe(false);
    expect(leavesOutNotMonthly(parsePeriod('2027'), false)).toBe(false);
    expect(leavesOutNotMonthly(null, false)).toBe(true);
  });
});

describe('the words', () => {
  it('says how many are not in the ring, and nothing for none', () => {
    expect(notMonthlyNote(0)).toBeNull();
    expect(notMonthlyNote(1)).toBe('1 not in the ring');
    expect(notMonthlyNote(3)).toBe('3 not in the ring');
  });

  it('the menu row is a grey word, and the dot counts Shown', () => {
    expect(notMonthlyWord(false)).toBe('Hidden');
    expect(notMonthlyWord(true)).toBe('Shown');
    expect(sortFilterCount({ sortValue: 'date:desc', paid: '', notMonthlyShown: true })).toBe(1);
    expect(sortFilterCount({ sortValue: 'date:desc', paid: '', notMonthlyShown: false })).toBe(0);
    expect(sortFilterCount({ sortValue: 'date:desc', paid: '' })).toBe(0);
  });

  it('never says "you"', () => {
    const words = [notMonthlyNote(1), notMonthlyNote(3), notMonthlyWord(false), notMonthlyWord(true), NOT_MONTHLY_BILL_NOTE].join(' ');
    expect(words).not.toMatch(/\byou(r)?\b/i);
  });
});

describe('the choice on this device', () => {
  afterEach(() => vi.unstubAllGlobals());
  const storage = (start: Record<string, string>) => {
    const kept = new Map(Object.entries(start));
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    });
    return kept;
  };

  it('is Hidden until chosen, and keeps what was chosen', () => {
    const kept = storage({});
    expect(readNotMonthlyShown()).toBe(false);
    writeNotMonthlyShown(true);
    expect(kept.get(NOT_MONTHLY_KEY)).toBe('1');
    expect(readNotMonthlyShown()).toBe(true);
    writeNotMonthlyShown(false);
    expect(readNotMonthlyShown()).toBe(false);
  });

  it("carries build 149's Yearly bills switch over once, then forgets the old key", () => {
    const kept = storage({ [OLD_YEARLY_BILLS_KEY]: '1' });
    expect(readNotMonthlyShown()).toBe(true);
    expect(kept.has(OLD_YEARLY_BILLS_KEY)).toBe(false);
    expect(kept.get(NOT_MONTHLY_KEY)).toBe('1');
    // Chosen Hidden afterwards, it stays Hidden: the old key is not read again.
    writeNotMonthlyShown(false);
    expect(readNotMonthlyShown()).toBe(false);
  });

  it('reads Hidden when storage refuses', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('refused');
      },
      setItem: () => {
        throw new Error('refused');
      },
      removeItem: () => undefined,
    });
    expect(readNotMonthlyShown()).toBe(false);
    expect(() => writeNotMonthlyShown(true)).not.toThrow();
  });
});
