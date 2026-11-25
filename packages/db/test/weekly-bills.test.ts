import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  billDetail,
  billLinkMonths,
  billsInMonth,
  categoryTotalsBetween,
  committedByCategory,
  createAccount,
  LedgerError,
  linkPurchaseToBill,
  listAccounts,
  listExpenseTemplates,
  monthlyBills,
  pauseBill,
  postTransaction,
  RecurringError,
  recordBillPayments,
  saveExpenseTemplate,
  skipBill,
  undoBillPayments,
  yearlyBills,
  type Database,
  type WorkspaceContext,
} from '../src/index';
import { settleTwicePaidBillsTx } from '../src/repos/bill-settle';
import { notMonthlyBillPaymentsOf } from '../src/repos/bill-repeat';
import { setupDb, type TestDb } from './helpers';

/*
 * Bills that repeat every few weeks (2026-11-25): a prepaid electricity token, Rp 1.000.000 roughly every 3 weeks,
 * first bought Tue 3 Nov 2026 — then 24 Nov, 15 Dec, 5 Jan. Invented bank, figures and names.
 */

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
  vi.useRealTimers();
});

const TOKEN = 1_000_000;

async function setup() {
  current = await setupDb();
  const { database, ws } = current;
  const all = await listAccounts(database, ws);
  const category = (key: string) => all.find((a) => a.systemKey === key)!.id;
  const electricity = category('utilities.electricity');
  const internetCategory = category('utilities.internet_provider');
  const bank = (await createAccount(database, ws, { name: 'Bank Contoh', kind: 'asset', subtype: 'bank', currency: 'IDR' })).id;
  const token = await saveExpenseTemplate(database, ws, {
    name: 'Electricity',
    categoryAccountId: electricity,
    moneyAccountId: bank,
    amountMinor: TOKEN,
    dayOfMonth: 1,
    repeat: 'weeks',
    repeatEvery: 3,
    startsOn: '2026-11-03',
  });
  return { database, ws, electricity, internetCategory, bank, token };
}

const pay = (database: Database, ws: WorkspaceContext, templateId: string, paidOn: string, billMonth = paidOn.slice(0, 7)) =>
  recordBillPayments(database, ws, { paidOn, payments: [{ templateId, billMonth, amountMinor: TOKEN }] });

const keysOf = async (database: Database, templateId: string) =>
  (await database.db.values<[string]>(sql`SELECT bill_month FROM bill_payments WHERE template_id = ${templateId} ORDER BY bill_month`)).map((r) => r[0]);

const code = async (run: Promise<unknown>) => {
  try {
    await run;
  } catch (e) {
    if (e instanceof RecurringError || e instanceof LedgerError) return e.code;
    throw e;
  }
  return null;
};

describe('a bill that repeats every few weeks', () => {
  it('is saved by its start date and gap, and reads back as weekly', async () => {
    const { database, ws, token } = await setup();
    const bill = (await listExpenseTemplates(database, ws)).find((t) => t.id === token)!;
    expect(bill).toMatchObject({ repeat: 'weeks', repeatEvery: 3, repeatMonth: null, startsMonth: '2026-11', dayOfMonth: 3, payByDay: null });
  });

  it('refuses a gap outside 1 to 8 weeks, and a start that is not a day', async () => {
    const { database, ws, electricity, bank } = await setup();
    const base = { name: 'Gas', categoryAccountId: electricity, moneyAccountId: bank, amountMinor: TOKEN, dayOfMonth: 1, repeat: 'weeks' as const };
    expect(await code(saveExpenseTemplate(database, ws, { ...base, repeatEvery: 9, startsOn: '2026-11-03' }))).toBe('EVERY_RANGE');
    expect(await code(saveExpenseTemplate(database, ws, { ...base, repeatEvery: 0, startsOn: '2026-11-03' }))).toBe('EVERY_RANGE');
    expect(await code(saveExpenseTemplate(database, ws, { ...base, repeatEvery: 3 }))).toBe('START_REQUIRED');
    expect(await code(saveExpenseTemplate(database, ws, { ...base, repeatEvery: 3, startsOn: '2026-11' }))).toBe('START_REQUIRED');
  });

  it('is due on its start date before anything is paid', async () => {
    const { database, ws, token } = await setup();
    const row = (await monthlyBills(database, ws, '2026-11-01')).find((b) => b.id === token)!;
    expect(row).toMatchObject({ billMonth: '2026-11-03', state: 'upcoming', days: 2, payableMonths: ['2026-11-03'] });
    expect(row.window).toEqual({ month: '2026-11', opensOn: '2026-11-03', payBy: '2026-11-03' });
    expect((await billDetail(database, ws, token, '2026-11-01')).weeks).toEqual({ everyWeeks: 3, startOn: '2026-11-03', nextDue: '2026-11-03', afterNext: '2026-11-24' });
  });

  it('keys each payment by its own day, so November holds two with neither paid twice', async () => {
    const { database, ws, token } = await setup();
    await pay(database, ws, token, '2026-11-03');
    await pay(database, ws, token, '2026-11-24');
    expect(await keysOf(database, token)).toEqual(['2026-11-03', '2026-11-24']);

    const detail = await billDetail(database, ws, token, '2026-11-25');
    expect(detail.weeks).toEqual({ everyWeeks: 3, startOn: '2026-11-03', nextDue: '2026-12-15', afterNext: '2027-01-05' });
    expect(detail.history.map((r) => [r.month, r.state, r.paidOn, r.paidMinor])).toEqual([
      ['2026-11-24', 'paid', '2026-11-24', TOKEN],
      ['2026-11-03', 'paid', '2026-11-03', TOKEN],
    ]);

    // The sync rule that lets a second payment of one month go finds nothing to let go.
    const ids = (await database.db.values<[string]>(sql`SELECT transaction_id FROM bill_payments WHERE template_id = ${token}`)).map((r) => r[0]);
    expect(await database.transaction((tx) => settleTwicePaidBillsTx(tx, ids))).toBe(0);
    expect(await keysOf(database, token)).toEqual(['2026-11-03', '2026-11-24']);
  });

  it('moves the rest with a payment made early', async () => {
    const { database, ws, token } = await setup();
    await pay(database, ws, token, '2026-11-03');
    await pay(database, ws, token, '2026-11-20');
    expect((await billDetail(database, ws, token, '2026-11-25')).weeks?.nextDue).toBe('2026-12-11');
  });

  it('takes one payment a day: a second on the same day is refused', async () => {
    const { database, ws, token } = await setup();
    await pay(database, ws, token, '2026-11-03');
    expect(await code(pay(database, ws, token, '2026-11-03'))).toBe('ALREADY_SETTLED');
  });

  it('keys a payment by the day paid, whatever the screen named', async () => {
    const { database, ws, token } = await setup();
    // The list's Pay names the next due date; the payment is still the day it was made.
    await pay(database, ws, token, '2026-11-05', '2026-11-03');
    expect(await keysOf(database, token)).toEqual(['2026-11-05']);
  });

  it('is owed again once its payment is undone', async () => {
    const { database, ws, token } = await setup();
    await pay(database, ws, token, '2026-11-03');
    const [second] = await pay(database, ws, token, '2026-11-24');
    await undoBillPayments(database, ws, [second!]);
    expect((await billDetail(database, ws, token, '2026-11-25')).weeks?.nextDue).toBe('2026-11-24');
    expect((await monthlyBills(database, ws, '2026-11-25')).find((b) => b.id === token)).toMatchObject({ state: 'overdue', days: 1, billMonth: '2026-11-24' });
  });

  it('reads as paid for the month once its next one falls after the month, for what the month paid', async () => {
    const { database, ws, token } = await setup();
    await pay(database, ws, token, '2026-11-03');
    expect((await monthlyBills(database, ws, '2026-11-05')).find((b) => b.id === token)).toMatchObject({ state: 'upcoming', billMonth: '2026-11-24', paidMinor: null });
    await pay(database, ws, token, '2026-11-24');
    expect((await monthlyBills(database, ws, '2026-11-25')).find((b) => b.id === token)).toMatchObject({ state: 'paid', billMonth: '2026-12-15', paidOn: '2026-11-24', paidMinor: 2 * TOKEN });
  });

  it('is listed with the monthly bills, never with the yearly ones', async () => {
    const { database, ws, token } = await setup();
    expect((await monthlyBills(database, ws, '2026-11-25')).some((b) => b.id === token)).toBe(true);
    expect((await yearlyBills(database, ws, '2026-11-25')).some((b) => b.id === token)).toBe(false);
  });

  it('is in a month once for each of its due dates', async () => {
    const { database, ws, token } = await setup();
    await pay(database, ws, token, '2026-11-03');
    await pay(database, ws, token, '2026-11-24');
    const rows = async (month: string) =>
      (await billsInMonth(database, ws, month, '2026-11-25')).filter((r) => r.bill.id === token).map((r) => [r.month, r.state]);
    expect(await rows('2026-11')).toEqual([
      ['2026-11-03', 'paid'],
      ['2026-11-24', 'paid'],
    ]);
    expect(await rows('2026-12')).toEqual([['2026-12-15', 'upcoming']]);
    expect(await rows('2027-01')).toEqual([
      ['2027-01-05', 'upcoming'],
      ['2027-01-26', 'upcoming'],
    ]);
  });

  it("speaks for the Budget's bills once per due date in the month (D1)", async () => {
    const { database, ws, token, electricity } = await setup();
    await pay(database, ws, token, '2026-11-03');
    await pay(database, ws, token, '2026-11-24');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-25T10:00:00'));
    expect((await committedByCategory(database, ws)).committed[electricity]).toBe(2 * TOKEN);
    vi.setSystemTime(new Date('2026-12-10T10:00:00'));
    expect((await committedByCategory(database, ws)).committed[electricity]).toBe(TOKEN);
    vi.setSystemTime(new Date('2027-01-10T10:00:00'));
    expect((await committedByCategory(database, ws)).committed[electricity]).toBe(2 * TOKEN);
  });

  it('counts each payment on the day it was made, also when paid in the month before it was due', async () => {
    const { database, ws, token, electricity } = await setup();
    await pay(database, ws, token, '2026-10-31', '2026-11-03');
    const october = await categoryTotalsBetween(database, ws, 'expense', '2026-10-01', '2026-10-31', { billMonths: true });
    const november = await categoryTotalsBetween(database, ws, 'expense', '2026-11-01', '2026-11-30', { billMonths: true });
    expect(october.find((r) => r.accountId === electricity)?.amountBaseMinor).toBe(TOKEN);
    expect(november.find((r) => r.accountId === electricity)).toBeUndefined();
    // And it is a monthly-counted payment: Cashflow keeps it in its month.
    const ids = (await database.db.values<[string]>(sql`SELECT transaction_id FROM bill_payments WHERE template_id = ${token}`)).map((r) => r[0]);
    expect(await notMonthlyBillPaymentsOf(database.db, ids)).toEqual(new Set());
  });

  it('links a purchase on its own day', async () => {
    const { database, ws, token, electricity, bank } = await setup();
    const bought = await postTransaction(database, ws, {
      occurredOn: '2026-11-24',
      description: 'Token listrik',
      lines: expenseLines({ categoryAccountId: electricity, paymentAccountId: bank, amountMinor: TOKEN, currency: 'IDR' }),
    });
    expect((await billLinkMonths(database, ws, { templateIds: [token], purchasedOn: '2026-11-24', today: '2026-11-25' }))[token]).toEqual({
      month: '2026-11-24',
      ask: false,
      opensOn: '2026-11-24',
    });
    // Whatever month the screen names, the link is the purchase's day.
    await linkPurchaseToBill(database, ws, { templateId: token, billMonth: '2026-11', transactionId: bought, today: '2026-11-25' });
    expect(await keysOf(database, token)).toEqual(['2026-11-24']);
    expect((await billDetail(database, ws, token, '2026-11-25')).history[0]).toMatchObject({ month: '2026-11-24', paidOn: '2026-11-24', payments: [{ id: bought, linked: true }] });
  });

  it('is neither skipped nor paused', async () => {
    const { database, ws, token } = await setup();
    expect(await code(skipBill(database, ws, token, '2026-11'))).toBe('WEEKS_NO_SKIP');
    expect(await code(pauseBill(database, ws, token, '2027-01', '2026-11-25'))).toBe('WEEKS_NO_PAUSE');
  });

  it('can be changed back to monthly', async () => {
    const { database, ws, token, electricity, bank } = await setup();
    await saveExpenseTemplate(database, ws, { id: token, name: 'Electricity', categoryAccountId: electricity, moneyAccountId: bank, amountMinor: TOKEN, dayOfMonth: 3, repeat: 'monthly' });
    expect((await listExpenseTemplates(database, ws)).find((t) => t.id === token)).toMatchObject({ repeat: 'monthly', repeatEvery: null });
  });
});

describe('monthly, yearly and every-few-months bills, beside a weekly one', () => {
  it('pay, list and count exactly as before', async () => {
    const { database, ws, token, internetCategory, bank } = await setup();
    const internet = await saveExpenseTemplate(database, ws, { name: 'Internet', categoryAccountId: internetCategory, moneyAccountId: bank, amountMinor: 385_000, dayOfMonth: 20, startsMonth: '2026-11' });
    await pay(database, ws, token, '2026-11-03');
    await recordBillPayments(database, ws, { paidOn: '2026-11-21', payments: [{ templateId: internet, billMonth: '2026-11', amountMinor: 385_000 }] });
    expect(await keysOf(database, internet)).toEqual(['2026-11']);
    expect((await monthlyBills(database, ws, '2026-11-25')).find((b) => b.id === internet)).toMatchObject({ billMonth: '2026-11', state: 'paid', paidMinor: 385_000, payableMonths: ['2026-12'] });
    expect((await billDetail(database, ws, internet, '2026-11-25')).weeks).toBeUndefined();
    // A monthly bill still takes a month, never a day…
    expect(await code(recordBillPayments(database, ws, { paidOn: '2026-12-21', payments: [{ templateId: internet, billMonth: '2026-12-21', amountMinor: 385_000 }] }))).toBe('MONTH_FORMAT');
    // …and once a month.
    expect(await code(recordBillPayments(database, ws, { paidOn: '2026-11-22', payments: [{ templateId: internet, billMonth: '2026-11', amountMinor: 385_000 }] }))).toBe('ALREADY_SETTLED');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-25T10:00:00'));
    expect((await committedByCategory(database, ws)).committed[internetCategory]).toBe(385_000);
    expect((await billsInMonth(database, ws, '2026-11', '2026-11-25')).filter((r) => r.bill.id === internet).map((r) => r.month)).toEqual(['2026-11']);
  });

  it('a month paid twice by two phones is still let go of the later payment', async () => {
    const { database, ws, internetCategory, bank } = await setup();
    const internet = await saveExpenseTemplate(database, ws, { name: 'Internet', categoryAccountId: internetCategory, moneyAccountId: bank, amountMinor: 385_000, dayOfMonth: 20, startsMonth: '2026-11' });
    const [first] = await recordBillPayments(database, ws, { paidOn: '2026-11-21', payments: [{ templateId: internet, billMonth: '2026-11', amountMinor: 385_000 }] });
    // As a second phone's payment arrives: the same month, written beside it.
    const second = await postTransaction(database, ws, {
      occurredOn: '2026-11-22',
      description: 'Internet',
      templateId: internet,
      lines: expenseLines({ categoryAccountId: internetCategory, paymentAccountId: bank, amountMinor: 385_000, currency: 'IDR' }),
    });
    await database.db.run(sql`INSERT INTO bill_payments (transaction_id, workspace_id, template_id, bill_month) VALUES (${second}, ${ws.workspaceId}, ${internet}, '2026-11') ON CONFLICT DO NOTHING`);
    expect(await database.transaction((tx) => settleTwicePaidBillsTx(tx, [first!, second]))).toBe(1);
    expect(await keysOf(database, internet)).toEqual(['2026-11']);
  });

  it('a yearly and an every-few-months bill keep their repeat', async () => {
    const { database, ws, internetCategory, bank } = await setup();
    const yearly = await saveExpenseTemplate(database, ws, { name: 'Domain', categoryAccountId: internetCategory, moneyAccountId: bank, amountMinor: 200_000, dayOfMonth: 12, repeat: 'yearly', repeatMonth: 3 });
    const quarterly = await saveExpenseTemplate(database, ws, { name: 'Water', categoryAccountId: internetCategory, moneyAccountId: bank, amountMinor: 90_000, dayOfMonth: 5, repeat: 'months', repeatMonth: 12, repeatEvery: 3 });
    const all = await listExpenseTemplates(database, ws);
    expect(all.find((t) => t.id === yearly)).toMatchObject({ repeat: 'yearly', repeatMonth: 3, repeatEvery: null });
    expect(all.find((t) => t.id === quarterly)).toMatchObject({ repeat: 'months', repeatMonth: 12, repeatEvery: 3 });
    expect((await yearlyBills(database, ws, '2026-11-25')).map((b) => b.id).sort()).toEqual([yearly, quarterly].sort());
  });
});
