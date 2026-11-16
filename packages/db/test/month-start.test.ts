import { addMonths, expenseLines, incomeLines, MONTH_START_LAST, monthPeriod, periodMonthOf } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  billLinkMonth,
  budgetSheetFor,
  linkPurchaseToBill,
  categoryTotalsIn,
  createAccount,
  inBook,
  listAccounts,
  listBooks,
  monthlyBills,
  monthStartFor,
  periodFlows,
  personalBook,
  postTransaction,
  recordBillPayments,
  saveBudget,
  saveExpenseTemplate,
  setBookMonthStart,
} from '../src/index';
import { periodMonthSql } from '../src/repos/bill-months';
import { setupDb, type TestDb } from './helpers';

/*
 * "Month starts on" (0118): a workspace whose months start on the 25th, salary day. Figures in rupiah, invented.
 */

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

async function household() {
  current = await setupDb();
  const { database } = current;
  const book = await personalBook(database, current.ws);
  const ws = inBook(current.ws, book.id);
  const bank = await createAccount(database, ws, { name: 'Bank Sentosa', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const all = await listAccounts(database, ws);
  const groceries = all.find((a) => a.systemKey === 'household.groceries')!.id;
  const salary = all.find((a) => a.systemKey === 'income.salary')!.id;
  const internet = all.find((a) => a.systemKey === 'utilities.internet_provider')!.id;
  const spend = (occurredOn: string, amountMinor: number) =>
    postTransaction(database, ws, { occurredOn, description: `Pasar ${occurredOn}`, lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: bank.id, amountMinor, currency: 'IDR' }) });
  // 24 Oct is October's (from the 25th), 25 Oct and 24 Nov November's, 25 Nov December's.
  await spend('2026-10-24', 110_000);
  await spend('2026-10-25', 230_000);
  await spend('2026-11-03', 340_000);
  await spend('2026-11-24', 470_000);
  await spend('2026-11-25', 590_000);
  await postTransaction(database, ws, { occurredOn: '2026-10-25', description: 'Gaji', lines: incomeLines({ incomeAccountId: salary, depositAccountId: bank.id, amountMinor: 17_500_000, currency: "IDR" }) });
  await saveBudget(database, ws, { categoryAccountId: groceries, amountMinor: 2_000_000 });
  return { database, ws, book, bank, groceries, salary, internet };
}

const spent = (sheet: Awaited<ReturnType<typeof budgetSheetFor>>, id: string) => {
  const walk = (lines: typeof sheet.lines): number | undefined => {
    for (const line of lines) {
      if (line.id === id) return line.totalMinor;
      const found = walk(line.children);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return walk(sheet.lines) ?? 0;
};

const snapshot = async (h: Awaited<ReturnType<typeof household>>) => ({
  rows: await h.database.db.values(sql`SELECT * FROM transactions ORDER BY id`),
  entries: await h.database.db.values(sql`SELECT * FROM entries ORDER BY id`),
});

describe('the setting', () => {
  it('is the 1st for every workspace that never set it', async () => {
    const h = await household();
    expect(await monthStartFor(h.database, h.ws)).toBe(1);
    expect((await listBooks(h.database, h.ws)).every((book) => book.monthStartDay === 1)).toBe(true);
  });

  it('keeps 1–28 or the last day, and refuses anything else', async () => {
    const h = await household();
    for (const bad of [0, 29, 30, 32, 2.5]) await expect(setBookMonthStart(h.database, h.ws, h.book.id, bad)).rejects.toThrow('A month starts on');
    await setBookMonthStart(h.database, h.ws, h.book.id, 25);
    expect(await monthStartFor(h.database, h.ws)).toBe(25);
    expect((await listBooks(h.database, h.ws)).find((b) => b.id === h.book.id)!.monthStartDay).toBe(25);
    await setBookMonthStart(h.database, h.ws, h.book.id, MONTH_START_LAST);
    expect(await monthStartFor(h.database, h.ws)).toBe(MONTH_START_LAST);
  });

  it('never edits a transaction: changing it only regroups', async () => {
    const h = await household();
    const before = await snapshot(h);
    await setBookMonthStart(h.database, h.ws, h.book.id, 25);
    await setBookMonthStart(h.database, h.ws, h.book.id, 1);
    expect(await snapshot(h)).toEqual(before);
  });

  it('an owner-wide read, with no workspace open, is calendar months', async () => {
    const h = await household();
    await setBookMonthStart(h.database, h.ws, h.book.id, 25);
    const { bookId: _open, ...owner } = h.ws;
    expect(await monthStartFor(h.database, owner)).toBe(1);
  });
});

describe('Budget and Cashflow totals for "November" from the 25th', () => {
  it('Budget counts 25 Oct to 24 Nov: 25 Oct in, 25 Nov out', async () => {
    const h = await household();
    await setBookMonthStart(h.database, h.ws, h.book.id, 25);
    const sheet = await budgetSheetFor(h.database, h.ws, '2026-11');
    expect(spent(sheet, h.groceries)).toBe(230_000 + 340_000 + 470_000);
    // The salary on the 25th starts November.
    expect(sheet.incomeActualMinor).toBe(17_500_000);
    expect(spent(await budgetSheetFor(h.database, h.ws, '2026-12'), h.groceries)).toBe(590_000);
    expect(spent(await budgetSheetFor(h.database, h.ws, '2026-10'), h.groceries)).toBe(110_000);
  });

  it('Cashflow’s totals over November’s dates agree with Budget', async () => {
    const h = await household();
    await setBookMonthStart(h.database, h.ws, h.book.id, 25);
    const { from, to } = monthPeriod('2026-11', await monthStartFor(h.database, h.ws));
    const totals = await categoryTotalsIn(h.database, h.ws, 'expense', from, to, { billMonths: true });
    expect(totals.rows.find((r) => r.accountId === h.groceries)!.amountBaseMinor).toBe(1_040_000);
  });

  it('regression: starting on the 1st reads exactly as before the setting existed', async () => {
    const h = await household();
    const untouched = await budgetSheetFor(h.database, h.ws, '2026-11');
    await setBookMonthStart(h.database, h.ws, h.book.id, 25);
    await setBookMonthStart(h.database, h.ws, h.book.id, 1);
    const back = await budgetSheetFor(h.database, h.ws, '2026-11');
    expect(back).toEqual(untouched);
    expect(spent(back, h.groceries)).toBe(340_000 + 470_000 + 590_000);
    expect(back.incomeActualMinor).toBe(0);
  });

  it('Financial health’s months are the workspace’s months when it names the day', async () => {
    const h = await household();
    const { bookId: _open, ...owner } = h.ws;
    const range = { from: monthPeriod('2026-10', 25).from, to: monthPeriod('2026-12', 25).to };
    const flows = await periodFlows(h.database, owner, range, { monthStart: 25 });
    expect(flows.byMonth.map((m) => [m.month, m.spendingMinor])).toEqual([
      ['2026-10', 110_000],
      ['2026-11', 1_040_000],
      ['2026-12', 590_000],
    ]);
    const calendar = await periodFlows(h.database, owner, { from: '2026-10-01', to: '2026-11-30' });
    expect(calendar.byMonth.map((m) => [m.month, m.spendingMinor])).toEqual([
      ['2026-10', 340_000],
      ['2026-11', 1_400_000],
    ]);
  });
});

describe('bills count in the month their date falls in', () => {
  async function withInternet() {
    const h = await household();
    // Out on the 27th, pay by the 5th of the month after.
    const bill = await saveExpenseTemplate(h.database, h.ws, {
      name: 'Kabel Nusantara', categoryAccountId: h.internet, moneyAccountId: h.bank.id, amountMinor: 385_000, dayOfMonth: 27, payByDay: 5, startsMonth: '2026-08',
    });
    return { ...h, bill };
  }

  it('on 16 Nov, from the 25th, the bill on the 27th speaks for its October bill; on the 1st, for November’s', async () => {
    const h = await withInternet();
    await recordBillPayments(h.database, h.ws, { paidOn: '2026-09-28', payments: [{ templateId: h.bill, billMonth: '2026-08', amountMinor: 385_000 }] });
    await recordBillPayments(h.database, h.ws, { paidOn: '2026-09-29', payments: [{ templateId: h.bill, billMonth: '2026-09', amountMinor: 385_000 }] });
    await recordBillPayments(h.database, h.ws, { paidOn: '2026-11-02', payments: [{ templateId: h.bill, billMonth: '2026-10', amountMinor: 385_000 }] });
    const calendar = (await monthlyBills(h.database, h.ws, '2026-11-16')).find((b) => b.id === h.bill)!;
    expect(calendar).toMatchObject({ billMonth: '2026-11', state: 'upcoming' });

    await setBookMonthStart(h.database, h.ws, h.book.id, 25);
    const fromThe25th = (await monthlyBills(h.database, h.ws, '2026-11-16')).find((b) => b.id === h.bill)!;
    expect(fromThe25th).toMatchObject({ billMonth: '2026-10', state: 'paid' });
    // From the 25th, November's own bill (27 Nov) is December's.
    expect((await monthlyBills(h.database, h.ws, '2026-11-26')).find((b) => b.id === h.bill)!).toMatchObject({ billMonth: '2026-11', state: 'upcoming' });
  });

  it('a bill paid late counts in the month its date fell in: out 27 Oct, paid 26 Nov, is November’s', async () => {
    const h = await withInternet();
    await setBookMonthStart(h.database, h.ws, h.book.id, 25);
    await recordBillPayments(h.database, h.ws, { paidOn: '2026-11-26', payments: [{ templateId: h.bill, billMonth: '2026-10', amountMinor: 385_000 }] });
    const nov = monthPeriod('2026-11', 25);
    const dec = monthPeriod('2026-12', 25);
    const of = async (range: { from: string; to: string }) =>
      (await categoryTotalsIn(h.database, h.ws, 'expense', range.from, range.to, { billMonths: true })).rows.find((r) => r.accountId === h.internet)?.amountBaseMinor ?? 0;
    expect(await of(nov)).toBe(385_000);
    expect(await of(dec)).toBe(0);
  });
});

describe('linking a purchase to a bill, and the last day', () => {
  it('from the 25th, internet on the 27th (no pay-by) bought on 3 Nov links its October bill, counted in November', async () => {
    const h = await household();
    const bill = await saveExpenseTemplate(h.database, h.ws, {
      name: 'Kabel Nusantara', categoryAccountId: h.internet, moneyAccountId: h.bank.id, amountMinor: 385_000, dayOfMonth: 27, payByDay: null, startsMonth: '2026-10',
    });
    await setBookMonthStart(h.database, h.ws, h.book.id, 25);
    const tx = await postTransaction(h.database, h.ws, {
      occurredOn: '2026-11-03', description: 'Kabel Nusantara', lines: expenseLines({ categoryAccountId: h.internet, paymentAccountId: h.bank.id, amountMinor: 385_000, currency: 'IDR' }),
    });
    const choice = await billLinkMonth(h.database, h.ws, { templateId: bill, purchasedOn: '2026-11-03', today: '2026-11-16' });
    expect(choice).toMatchObject({ month: '2026-10', ask: false });
    await linkPurchaseToBill(h.database, h.ws, { templateId: bill, billMonth: choice.month, transactionId: tx, today: '2026-11-16' });
    expect((await monthlyBills(h.database, h.ws, '2026-11-16')).find((b) => b.id === bill)).toMatchObject({ billMonth: '2026-10', state: 'paid' });
    const nov = monthPeriod('2026-11', 25);
    const totals = await categoryTotalsIn(h.database, h.ws, 'expense', nov.from, nov.to, { billMonths: true });
    expect(totals.rows.find((r) => r.accountId === h.internet)?.amountBaseMinor).toBe(385_000);
    // On the 1st the same purchase is November's.
    await setBookMonthStart(h.database, h.ws, h.book.id, 1);
    expect(await billLinkMonth(h.database, h.ws, { templateId: bill, purchasedOn: '2026-11-03', today: '2026-11-16' })).toMatchObject({ month: '2026-11' });
  });

  it('from the last day, November’s bill on the 30th, paid late, counts in November (31 Oct – 29 Nov), as the bills page has it', async () => {
    const h = await household();
    const bill = await saveExpenseTemplate(h.database, h.ws, {
      name: 'Sewa gudang', categoryAccountId: h.internet, moneyAccountId: h.bank.id, amountMinor: 640_000, dayOfMonth: 30, payByDay: null, startsMonth: '2026-11',
    });
    await setBookMonthStart(h.database, h.ws, h.book.id, MONTH_START_LAST);
    await recordBillPayments(h.database, h.ws, { paidOn: '2026-12-02', payments: [{ templateId: bill, billMonth: '2026-11', amountMinor: 640_000 }] });
    const of = async (month: string) => {
      const { from, to } = monthPeriod(month, MONTH_START_LAST);
      return (await categoryTotalsIn(h.database, h.ws, 'expense', from, to, { billMonths: true })).rows.find((r) => r.accountId === h.internet)?.amountBaseMinor ?? 0;
    };
    expect(await of('2026-11')).toBe(640_000);
    expect(await of('2026-12')).toBe(0);
    expect((await monthlyBills(h.database, h.ws, '2026-11-20')).find((b) => b.id === bill)).toMatchObject({ billMonth: '2026-11', state: 'paid' });
  });
});

describe('periodMonthSql is periodMonthOf, in SQL', () => {
  it('agrees with core for every start day across four years of days', async () => {
    current = await setupDb();
    const days: string[] = [];
    for (let month = '2026-12'; month <= '2029-03'; month = addMonths(month, 1)) {
      for (const d of [1, 2, 14, 15, 16, 24, 25, 27, 28, 29, 30, 31]) {
        const date = `${month}-${String(d).padStart(2, '0')}`;
        if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date) days.push(date);
      }
    }
    for (const start of [1, 2, 5, 15, 16, 25, 28, MONTH_START_LAST]) {
      for (const date of days) {
        const [row] = await current.database.db.values<[string]>(sql`SELECT ${periodMonthSql(sql`${date}`, start)}`);
        expect([start, date, row![0]]).toEqual([start, date, periodMonthOf(date, start)]);
      }
    }
  });
});
