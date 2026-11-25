import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BudgetError,
  budgetSheetFor,
  createAccount,
  createDatabase,
  createWorkspace,
  inBook,
  listAccounts,
  listBudgets,
  migrate,
  MIGRATIONS,
  personalBook,
  postTransaction,
  recordBillPayments,
  saveBudget,
  saveBudgets,
  saveExpenseTemplate,
  setBookMonthStart,
  setBudgetOverride,
} from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';
import { setupDb, type TestDb } from './helpers';

/*
 * Budget C (2026-11-25): a budget typed the way it repeats — Rp 50.000 a day, the son's pocket money Rp 100.000 a week,
 * the electricity token Rp 1.000.000 every 3 weeks — watched by the month: the amount × how many times it comes up in
 * that month. November 2026 has 30 days and 5 Mondays, December 31 days and 4 Mondays. Invented bank and figures.
 */

let current: TestDb | undefined;
let executor: NodeExecutor | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
  executor?.close();
  executor = undefined;
});

async function setup() {
  current = await setupDb();
  const { database } = current;
  const book = await personalBook(database, current.ws);
  const ws = inBook(current.ws, book.id);
  const all = await listAccounts(database, ws);
  const category = (key: string) => all.find((a) => a.systemKey === key)!.id;
  const bank = (await createAccount(database, ws, { name: 'Bank Contoh', kind: 'asset', subtype: 'bank', currency: 'IDR' })).id;
  return {
    database,
    ws,
    book,
    bank,
    groceries: category('household.groceries'),
    electricity: category('utilities.electricity'),
    internet: category('utilities.internet_provider'),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const planIn = async (h: Setup, categoryId: string, month: string) => (await listBudgets(h.database, h.ws, month)).find((row) => row.categoryAccountId === categoryId);
const code = (run: Promise<unknown>) => run.then(() => null, (e: unknown) => (e instanceof BudgetError ? e.code : Promise.reject(e)));

describe('a budget by days or weeks, read by the month', () => {
  it("a week: the son's pocket money, 100.000 a week, is 500.000 in November and 400.000 in December", async () => {
    const h = await setup();
    await saveBudget(h.database, h.ws, { categoryAccountId: h.groceries, amountMinor: 100_000, frequency: 'weekly' });
    expect(await planIn(h, h.groceries, '2026-11')).toMatchObject({ planMinor: 500_000, amountMinor: 500_000, frequency: 'weekly', everyWeeks: 1, startsOn: null, amountAsSetMinor: 100_000 });
    expect(await planIn(h, h.groceries, '2026-12')).toMatchObject({ planMinor: 400_000, amountMinor: 400_000 });
  });

  it('a day: 50.000 a day is 1.500.000 in November and 1.550.000 in December', async () => {
    const h = await setup();
    await saveBudget(h.database, h.ws, { categoryAccountId: h.groceries, amountMinor: 50_000, frequency: 'daily' });
    expect(await planIn(h, h.groceries, '2026-11')).toMatchObject({ planMinor: 1_500_000, everyWeeks: null, startsOn: null });
    expect(await planIn(h, h.groceries, '2026-12')).toMatchObject({ planMinor: 1_550_000 });
  });

  it('every 3 weeks from 3 Nov: 2.000.000 in November, 1.000.000 in December, 2.000.000 in January', async () => {
    const h = await setup();
    await saveBudget(h.database, h.ws, { categoryAccountId: h.electricity, amountMinor: 1_000_000, frequency: 'weekly', everyWeeks: 3, startsOn: '2026-11-03' });
    expect(await planIn(h, h.electricity, '2026-11')).toMatchObject({ planMinor: 2_000_000, everyWeeks: 3, startsOn: '2026-11-03' });
    expect((await planIn(h, h.electricity, '2026-12'))?.planMinor).toBe(1_000_000);
    expect((await planIn(h, h.electricity, '2027-01'))?.planMinor).toBe(2_000_000);
    // Counted back from its start as well: 13 Oct.
    expect((await planIn(h, h.electricity, '2026-10'))?.planMinor).toBe(1_000_000);
    // What every reader that does not count keeps: the average month, 1.000.000 × 52 ÷ 12 ÷ 3.
    expect((await h.database.db.values<[number]>(sql`SELECT amount_minor FROM budgets WHERE category_account_id = ${h.electricity}`))[0]![0]).toBe(1_444_444);
  });

  it('counts the month from "Month starts on": the 25th makes November 25 Oct – 24 Nov', async () => {
    const h = await setup();
    await setBookMonthStart(h.database, h.ws, h.book.id, 25);
    await saveBudget(h.database, h.ws, { categoryAccountId: h.groceries, amountMinor: 100_000, frequency: 'weekly' });
    await saveBudget(h.database, h.ws, { categoryAccountId: h.internet, amountMinor: 10_000, frequency: 'daily' });
    // Mondays 26 Oct, 2, 9, 16, 23 Nov; 31 days.
    expect((await planIn(h, h.groceries, '2026-11'))?.planMinor).toBe(500_000);
    expect((await planIn(h, h.internet, '2026-11'))?.planMinor).toBe(310_000);
    // "December", 25 Nov – 24 Dec: Mondays 30 Nov, 7, 14, 21 Dec; 30 days.
    expect((await planIn(h, h.groceries, '2026-12'))?.planMinor).toBe(400_000);
    expect((await planIn(h, h.internet, '2026-12'))?.planMinor).toBe(300_000);
  });

  it('is what the Budget page counts: the cap, what is left, and over or not, for the month', async () => {
    const h = await setup();
    await saveBudget(h.database, h.ws, { categoryAccountId: h.groceries, amountMinor: 100_000, frequency: 'weekly' });
    await postTransaction(h.database, h.ws, {
      occurredOn: '2026-12-10',
      description: 'Pasar',
      lines: expenseLines({ categoryAccountId: h.groceries, paymentAccountId: h.bank, amountMinor: 450_000, currency: 'IDR' }),
    });
    const nov = await budgetSheetFor(h.database, h.ws, '2026-11');
    const dec = await budgetSheetFor(h.database, h.ws, '2026-12');
    const line = (sheet: typeof nov) => sheet.lines.flatMap((l) => [l, ...l.children]).find((l) => l.id === h.groceries)!;
    expect(line(nov)).toMatchObject({ capMinor: 500_000, totalMinor: 0, overMinor: 0 });
    // 450.000 against December's four Mondays, 400.000: over by 50.000.
    expect(line(dec)).toMatchObject({ capMinor: 400_000, totalMinor: 450_000, overMinor: 50_000 });
  });

  it("a month's own figure still overrides it, and a % of it is a % of the month's figure", async () => {
    const h = await setup();
    const kids = (await createAccount(h.database, h.ws, { name: 'Jajan', kind: 'expense', subtype: 'category', currency: null, parentId: h.groceries })).id;
    await saveBudget(h.database, h.ws, { categoryAccountId: h.groceries, amountMinor: 100_000, frequency: 'weekly' });
    await saveBudget(h.database, h.ws, { categoryAccountId: kids, amountMinor: 250_000, share: { basis: 'parent', bp: 5000 } });
    expect((await planIn(h, kids, '2026-11'))?.planMinor).toBe(250_000);
    expect((await planIn(h, kids, '2026-12'))?.planMinor).toBe(200_000);
    await setBudgetOverride(h.database, h.ws, { categoryAccountId: h.groceries, month: '2026-12', amountMinor: 900_000 });
    expect(await planIn(h, h.groceries, '2026-12')).toMatchObject({ planMinor: 400_000, amountMinor: 900_000, overridden: true });
    // A % is a month's figure: it never repeats by days or weeks.
    expect(await code(saveBudget(h.database, h.ws, { categoryAccountId: kids, amountMinor: 250_000, frequency: 'weekly', share: { basis: 'parent', bp: 5000 } }))).toBe('BAD_FREQUENCY');
  });

  it('refuses a gap on anything but a week, a gap past 8 weeks, and every few weeks without its start', async () => {
    const h = await setup();
    const save = (input: Partial<Parameters<typeof saveBudget>[2]>) => code(saveBudget(h.database, h.ws, { categoryAccountId: h.groceries, amountMinor: 100_000, ...input }));
    expect(await save({ frequency: 'daily', everyWeeks: 2, startsOn: '2026-11-03' })).toBe('BAD_REPEAT');
    expect(await save({ frequency: 'monthly', everyWeeks: 3, startsOn: '2026-11-03' })).toBe('BAD_REPEAT');
    expect(await save({ frequency: 'weekly', everyWeeks: 9, startsOn: '2026-11-03' })).toBe('BAD_REPEAT');
    expect(await save({ frequency: 'weekly', everyWeeks: 0 })).toBe('BAD_REPEAT');
    expect(await save({ frequency: 'weekly', everyWeeks: 3 })).toBe('NO_START');
    expect(await save({ frequency: 'weekly', everyWeeks: 3, startsOn: '2026-02-30' })).toBe('NO_START');
    expect(await planIn(h, h.groceries, '2026-11')).toBeUndefined();
    // Every week keeps no start, whatever was sent.
    await saveBudget(h.database, h.ws, { categoryAccountId: h.groceries, amountMinor: 100_000, frequency: 'weekly', everyWeeks: 1, startsOn: '2026-11-03' });
    expect(await planIn(h, h.groceries, '2026-11')).toMatchObject({ everyWeeks: 1, startsOn: null });
  });

  it('Edit budgets saves a gap and its start with the rest, and names the row it refuses', async () => {
    const h = await setup();
    await saveBudgets(
      h.database,
      h.ws,
      {
        save: [
          { categoryAccountId: h.electricity, amountMinor: 1_000_000, frequency: 'weekly', everyWeeks: 3, startsOn: '2026-11-03' },
          { categoryAccountId: h.groceries, amountMinor: 100_000, frequency: 'weekly' },
        ],
        remove: [],
      },
      '2026-11',
    );
    expect((await planIn(h, h.electricity, '2026-11'))?.planMinor).toBe(2_000_000);
    expect((await planIn(h, h.groceries, '2026-11'))?.planMinor).toBe(500_000);
    const refused = await saveBudgets(h.database, h.ws, { save: [{ categoryAccountId: h.internet, amountMinor: 1, frequency: 'weekly', everyWeeks: 4 }], remove: [] }, '2026-11').catch((e: unknown) => e);
    expect(refused).toMatchObject({ code: 'NO_START', categoryAccountId: h.internet });
  });
});

describe('the Electricity budget and the Electricity bill', () => {
  async function withBill() {
    const h = await setup();
    const token = await saveExpenseTemplate(h.database, h.ws, {
      name: 'Electricity',
      categoryAccountId: h.electricity,
      moneyAccountId: h.bank,
      amountMinor: 1_000_000,
      dayOfMonth: 3,
      repeat: 'weeks',
      repeatEvery: 3,
      startsOn: '2026-11-03',
    });
    const pay = (paidOn: string) => recordBillPayments(h.database, h.ws, { paidOn, payments: [{ templateId: token, billMonth: paidOn, amountMinor: 1_000_000 }] });
    return { ...h, token, pay };
  }

  it("a budget by the bill's weeks is due on the bill's dates: 3 and 24 Nov, 15 Dec", async () => {
    const h = await withBill();
    // Its own start says otherwise (Mondays 2, 23 Nov, 14 Dec): the bill's dates are the ones counted.
    await saveBudget(h.database, h.ws, { categoryAccountId: h.electricity, amountMinor: 1_000_000, frequency: 'weekly', everyWeeks: 3, startsOn: '2026-11-30' });
    expect((await planIn(h, h.electricity, '2026-11'))?.planMinor).toBe(2_000_000);
    expect((await planIn(h, h.electricity, '2026-12'))?.planMinor).toBe(1_000_000);
  });

  it('moves with the bill: a token bought late on 1 Dec makes November one and December two', async () => {
    const h = await withBill();
    await saveBudget(h.database, h.ws, { categoryAccountId: h.electricity, amountMinor: 1_000_000, frequency: 'weekly', everyWeeks: 3, startsOn: '2026-11-03' });
    await h.pay('2026-11-03');
    await h.pay('2026-12-01');
    // November: paid 3 Nov; December: paid 1 Dec and due 22 Dec — what was spent, and what the bill still asks.
    expect((await planIn(h, h.electricity, '2026-11'))?.planMinor).toBe(1_000_000);
    expect((await planIn(h, h.electricity, '2026-12'))?.planMinor).toBe(2_000_000);
    const nov = await budgetSheetFor(h.database, h.ws, '2026-11');
    const line = nov.lines.flatMap((l) => [l, ...l.children]).find((l) => l.id === h.electricity)!;
    expect(line).toMatchObject({ capMinor: 1_000_000, totalMinor: 1_000_000, overMinor: 0 });
  });

  it('a budget by other weeks than the bill keeps its own dates', async () => {
    const h = await withBill();
    await saveBudget(h.database, h.ws, { categoryAccountId: h.electricity, amountMinor: 500_000, frequency: 'weekly', everyWeeks: 2, startsOn: '2026-11-02' });
    // 2, 16, 30 Nov.
    expect((await planIn(h, h.electricity, '2026-11'))?.planMinor).toBe(1_500_000);
  });
});

describe('a monthly budget', () => {
  it('reads exactly as before: its amount every month, by any month start, with no unit kept', async () => {
    const h = await setup();
    await saveBudget(h.database, h.ws, { categoryAccountId: h.groceries, amountMinor: 2_000_000 });
    await saveBudget(h.database, h.ws, { categoryAccountId: h.internet, amountMinor: 2_400_010, frequency: 'yearly' });
    for (const month of ['2026-02', '2026-11', '2026-12', '2027-01']) {
      expect(await planIn(h, h.groceries, month)).toMatchObject({ planMinor: 2_000_000, amountMinor: 2_000_000, frequency: 'monthly', everyWeeks: null, startsOn: null, amountAsSetMinor: 2_000_000 });
      expect((await planIn(h, h.internet, month))?.planMinor).toBe(200_001);
    }
    await setBookMonthStart(h.database, h.ws, h.book.id, 25);
    expect((await planIn(h, h.groceries, '2026-11'))?.planMinor).toBe(2_000_000);
    expect((await h.database.db.values<[number]>(sql`SELECT count(*) FROM budget_frequencies WHERE budget_id IN (SELECT id FROM budgets WHERE category_account_id = ${h.groceries})`))[0]![0]).toBe(0);
  });

  it('a week set monthly again forgets its gap and start', async () => {
    const h = await setup();
    await saveBudget(h.database, h.ws, { categoryAccountId: h.electricity, amountMinor: 1_000_000, frequency: 'weekly', everyWeeks: 3, startsOn: '2026-11-03' });
    await saveBudget(h.database, h.ws, { categoryAccountId: h.electricity, amountMinor: 1_500_000 });
    expect(await planIn(h, h.electricity, '2026-11')).toMatchObject({ planMinor: 1_500_000, frequency: 'monthly', everyWeeks: null, startsOn: null });
  });
});

describe('a database stopped before 0129', () => {
  it('counts a week by its Mondays, and refuses every few weeks', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database, MIGRATIONS.filter((m) => m.version <= 128));
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const groceries = (await listAccounts(database, ws)).find((a) => a.systemKey === 'household.groceries')!.id;
    await saveBudget(database, ws, { categoryAccountId: groceries, amountMinor: 100_000, frequency: 'weekly' });
    expect((await listBudgets(database, ws, '2026-11'))[0]).toMatchObject({ planMinor: 500_000, everyWeeks: 1, startsOn: null });
    expect(await code(saveBudget(database, ws, { categoryAccountId: groceries, amountMinor: 100_000, frequency: 'weekly', everyWeeks: 3, startsOn: '2026-11-03' }))).toBe('NO_REPEAT');
    expect((await listBudgets(database, ws, '2026-11'))[0]).toMatchObject({ planMinor: 500_000 });
  });
});
